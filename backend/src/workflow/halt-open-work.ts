import type { UnitOfWork } from '../common/prisma.js';
import type { LinkTokenRepository } from '../auth/link-token.repository.js';
import type { AssetFormRepository } from '../modules/assets/asset-form.repository.js';
import type { GosiRepository } from '../modules/processes/gosi.repository.js';
import type { MedicalInsuranceRepository } from '../modules/processes/medical-insurance.repository.js';
import type { AuditLogRepository } from './audit-log.repository.js';
import type { Actor } from './engine.js';

/** Why the open work is being stopped — recorded on every audit row. */
export type HaltCause = 'WITHDRAWN' | 'OFFBOARDING';

export interface HaltScope {
  linkTokens: LinkTokenRepository;
  assetForms: AssetFormRepository;
  gosi: GosiRepository;
  medical: MedicalInsuranceRepository;
  audit: AuditLogRepository;
}

export interface HaltResult {
  /** Signed links that were still usable and are now dead. */
  links: number;
  /** Custody forms moved to CANCELLED. */
  assetForms: number;
  /** Stage-2 process cards moved to CANCELLED. */
  processes: string[];
}

/**
 * Business rule: when a trainee withdraws or an employee is offboarded,
 * every open action on their file stops — pending links, undecided custody
 * forms, GOSI / medical cards still in progress — regardless of stage.
 * Nothing is deleted: each stop is a status move with its own audit row, so
 * the history keeps showing what was underway and why it ended.
 *
 * The criminal-record card has no cancelled state by design (it only moves
 * forward), so it is left where it is; SLA rules never watch it.
 */
export class OpenWorkHalter {
  constructor(private readonly transact: UnitOfWork<HaltScope>) {}

  halt(employeeId: string, cause: HaltCause, actor: Actor): Promise<HaltResult> {
    return this.transact(async (s) => {
      const now = new Date();
      const who = {
        actorType: actor.type,
        ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
      };

      const links = await s.linkTokens.invalidateAllForEmployee(employeeId, now);

      let assetForms = 0;
      for (const form of await s.assetForms.listOpenByEmployee(employeeId)) {
        if (!(await s.assetForms.moveStatus(form.id, form.status, 'CANCELLED'))) continue;
        assetForms += 1;
        await s.audit.append({
          entity: 'ASSET_FORM',
          entityId: form.id,
          action: 'CANCEL',
          fromStatus: form.status,
          toStatus: 'CANCELLED',
          employeeId,
          metadata: { cause },
          ...who,
        });
      }

      const processes: string[] = [];
      const gosi = await s.gosi.findByEmployee(employeeId);
      if (gosi && (gosi.status === 'PENDING' || gosi.status === 'ON_HOLD')) {
        if (await s.gosi.moveStatus(gosi.id, gosi.status, 'CANCELLED')) {
          processes.push('GOSI');
          await s.audit.append({
            entity: 'GOSI',
            entityId: gosi.id,
            action: 'CANCEL',
            fromStatus: gosi.status,
            toStatus: 'CANCELLED',
            employeeId,
            metadata: { cause },
            ...who,
          });
        }
      }
      const medical = await s.medical.findByEmployee(employeeId);
      if (medical && (medical.status === 'PENDING' || medical.status === 'ON_HOLD')) {
        if (await s.medical.moveStatus(medical.id, medical.status, 'CANCELLED')) {
          processes.push('MEDICAL_INSURANCE');
          await s.audit.append({
            entity: 'MEDICAL_INSURANCE',
            entityId: medical.id,
            action: 'CANCEL',
            fromStatus: medical.status,
            toStatus: 'CANCELLED',
            employeeId,
            metadata: { cause },
            ...who,
          });
        }
      }

      return { links, assetForms, processes };
    });
  }
}
