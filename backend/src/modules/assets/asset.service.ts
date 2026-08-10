import type { Actor, OwnershipLookup } from '../../workflow/engine.js';
import { Workflow } from '../../workflow/engine.js';
import { assetFormMachine } from '../../workflow/machines/asset-form.machine.js';
import { GuardFailedError, NotFoundError } from '../../workflow/errors.js';
import type { AssetForm } from '../../generated/prisma/client.js';
import type { AssetFormStatus } from '../../generated/prisma/enums.js';
import type { UnitOfWork } from '../../common/prisma.js';
import type { AssetRepository } from './asset.repository.js';
import type { AssetFormRepository, AssetFormItemInput } from './asset-form.repository.js';
import type { EmployeeRepository } from '../employees/employee.repository.js';
import type { AuditLogRepository } from '../../workflow/audit-log.repository.js';
import type { LinkTokenService } from '../../auth/link-token.service.js';
import type { NotificationService } from '../../notifications/notification.service.js';

/** The verified link row shape the routes hand over (from LinkTokenService). */
interface AssetLinkRow {
  id: string;
  purpose: string;
  assetFormId: string | null;
}

/** One custody-form unit of work — everything shares one transaction. */
export interface AssetTxScope {
  forms: AssetFormRepository;
  audit: AuditLogRepository;
  /** Single-use stamp for the link consumed by this unit of work. */
  markLinkUsed: (tokenId: string, at: Date) => Promise<unknown>;
}

/**
 * Stage 2 — asset custody (إدارة العهد). HR builds an electronic custody
 * form, the employee e-approves it through a signed link, and approved
 * items stay linked to the employee file for offboarding and inventory.
 *
 * Status transitions, their audit rows and their timestamp stamps run
 * inside one transaction; link issuance and email stay outside.
 */
export class AssetService {
  private readonly machine;

  constructor(
    private readonly repos: {
      assets: AssetRepository;
      forms: AssetFormRepository;
      employees: EmployeeRepository;
      audit: AuditLogRepository;
    },
    private readonly links: LinkTokenService,
    private readonly notifications: NotificationService,
    private readonly transact: UnitOfWork<AssetTxScope>,
    private readonly ownership?: OwnershipLookup,
  ) {
    // Guards read through the root client — they run before the guarded
    // move, exactly as a pre-check, so they don't need the transaction.
    this.machine = assetFormMachine({ countItems: (formId) => repos.forms.countItems(formId) });
  }

  /** The machine bound to one unit of work's repositories. */
  private workflowFor(s: AssetTxScope): Workflow<AssetForm> {
    return new Workflow<AssetForm>(this.machine, {
      getId: (f) => f.id,
      getStatus: (f) => f.status,
      ...(this.ownership ? { ownership: this.ownership } : {}),
      move: (f, from, to) =>
        s.forms.moveStatus(f.id, from as AssetFormStatus, to as AssetFormStatus),
      audit: (entry) => s.audit.append(entry),
      anchors: (f) => ({ employeeId: f.employeeId }),
    });
  }

  /** Read-only view of available actions (no persistence involved). */
  availableActions(form: AssetForm, actor: Actor): string[] {
    return this.workflowFor({
      forms: this.repos.forms,
      audit: this.repos.audit,
      markLinkUsed: () => Promise.resolve({}),
    }).availableActions(form.status, actor);
  }

  // ------------------------------------------------------------ registry

  listAssets() {
    return this.repos.assets.list();
  }

  createAsset(data: { type: string; name: string; serialNumber?: string; notes?: string }) {
    return this.repos.assets.create(data);
  }

  // ------------------------------------------------------------ HR side

  async createForm(
    input: {
      employeeId: string;
      deliveryDate?: Date;
      items: AssetFormItemInput[];
    },
    actor: Actor,
  ) {
    const employee = await this.repos.employees.findById(input.employeeId);
    if (!employee) throw new NotFoundError('employee', input.employeeId);

    return this.transact(async (s) => {
      const form = await s.forms.create({ ...input, createdById: actor.id ?? '' });
      await s.audit.append({
        entity: 'ASSET_FORM',
        entityId: form.id,
        action: 'CREATE',
        toStatus: form.status,
        actorType: actor.type,
        ...(actor.id ? { actorId: actor.id } : {}),
        employeeId: input.employeeId,
      });
      return form;
    });
  }

  async replaceItems(formId: string, items: AssetFormItemInput[], _actor: Actor) {
    const form = await this.mustFind(formId);
    if (form.status !== 'DRAFT') {
      throw new GuardFailedError('NOT_DRAFT', 'items can only be edited while the form is a draft');
    }
    // delete-then-recreate is atomic inside the unit of work.
    return this.transact((s) => s.forms.replaceItems(formId, items));
  }

  /** SEND: machine guards non-empty; then link + email to the employee. */
  async send(formId: string, actor: Actor) {
    const form = await this.mustFind(formId);
    await this.transact(async (s) => {
      await this.workflowFor(s).transition(form, 'SEND', actor);
      await s.forms.moveStatus(formId, 'SENT', 'SENT', { sentAt: new Date() });
    });

    const employee = form.employee;
    const link = await this.links.issue('ASSET_APPROVAL', {
      employeeId: form.employeeId,
      assetFormId: formId,
    });
    await this.notifications.notifyExternal(
      employee.email,
      'employee.asset_approval',
      { name: `${employee.firstName} ${employee.lastName}`, linkUrl: link.url },
      { entity: 'ASSET_FORM', entityId: formId },
    );
    await this.repos.audit.append({
      entity: 'ASSET_FORM',
      entityId: formId,
      action: 'LINK_SENT',
      actorType: actor.type,
      ...(actor.id ? { actorId: actor.id } : {}),
      employeeId: form.employeeId,
      metadata: { purpose: 'ASSET_APPROVAL' },
    });
    return { url: link.url, expiresAt: link.expiresAt };
  }

  async cancel(formId: string, actor: Actor) {
    const form = await this.mustFind(formId);
    return this.transact((s) => this.workflowFor(s).transition(form, 'CANCEL', actor));
  }

  async revise(formId: string, actor: Actor) {
    const form = await this.mustFind(formId);
    return this.transact((s) => this.workflowFor(s).transition(form, 'REVISE', actor));
  }

  // ------------------------------------------------------- signed-link side

  /** Context for the public approval page; first open moves SENT → PENDING. */
  async buildLinkContext(row: AssetLinkRow) {
    if (!row.assetFormId) throw new NotFoundError('link', 'no asset form attached');
    const form = await this.mustFind(row.assetFormId);

    if (form.status === 'SENT') {
      await this.transact((s) =>
        this.workflowFor(s).transition(form, 'OPEN', { type: 'LINK', id: row.id }),
      );
      form.status = 'PENDING_EMPLOYEE_APPROVAL';
    }

    return {
      purpose: 'ASSET_APPROVAL' as const,
      employee: {
        firstName: form.employee.firstName,
        lastName: form.employee.lastName,
        employeeNo: form.employee.employeeNo,
        department: form.employee.department,
        jobTitle: form.employee.jobTitle,
      },
      form: {
        status: form.status,
        deliveryDate: form.deliveryDate,
        items: form.items.map((i) => ({
          type: i.type,
          name: i.name,
          serialNumber: i.serialNumber,
          quantity: i.quantity,
          condition: i.condition,
          notes: i.notes,
        })),
      },
    };
  }

  /** Employee decides through the signed link — approve or reject. */
  async decide(rawToken: string, decision: 'APPROVE' | 'REJECT', rejectReason?: string) {
    const token = await this.links.verify(rawToken);
    if (token.purpose !== 'ASSET_APPROVAL' || !token.assetFormId) {
      throw new NotFoundError('link', 'not an asset-approval link');
    }
    const form = await this.mustFind(token.assetFormId);
    const now = new Date();

    const result = await this.transact(async (s) => {
      const workflow = this.workflowFor(s);

      // A decision straight from the email (no prior GET) implies opening.
      if (form.status === 'SENT') {
        await workflow.transition(form, 'OPEN', { type: 'LINK', id: token.id });
        form.status = 'PENDING_EMPLOYEE_APPROVAL';
      }

      const r = await workflow.transition(
        form,
        decision,
        { type: 'LINK', id: token.id },
        rejectReason ? { rejectReason } : undefined,
      );

      await s.forms.moveStatus(form.id, r.to as AssetFormStatus, r.to as AssetFormStatus, {
        decidedAt: now,
        ...(decision === 'REJECT' && rejectReason ? { rejectReason } : {}),
      });
      await s.markLinkUsed(token.id, now);
      return r;
    });

    await this.notifications.notifyHr(
      'hr.asset_decided',
      { name: `${form.employee.firstName} ${form.employee.lastName}` },
      { entity: 'ASSET_FORM', entityId: form.id },
    );
    return result;
  }

  // ------------------------------------------------------------------ private

  private async mustFind(id: string) {
    const form = await this.repos.forms.findWithItems(id);
    if (!form) throw new NotFoundError('asset form', id);
    return form;
  }
}
