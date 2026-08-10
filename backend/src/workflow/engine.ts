import type { AuditEntry } from './audit-log.repository.js';
import {
  ForbiddenActorError,
  IllegalTransitionError,
  StaleTransitionError,
} from './errors.js';

export type ActorType = 'USER' | 'LINK' | 'SYSTEM';

export interface Actor {
  type: ActorType;
  /** User id when type is USER; token id when type is LINK. */
  id?: string;
  /** Staff role (HR/ADMIN) when type is USER. */
  role?: string;
}

export interface TransitionContext<TRecord> {
  record: TRecord;
  actor: Actor;
}

export interface TransitionDef<TRecord> {
  action: string;
  from: string;
  /** Static target, or a resolver for dynamic targets (e.g. reopen). */
  to: string | ((ctx: TransitionContext<TRecord>) => string | Promise<string>);
  /** Actor types allowed to perform this transition. */
  actors: ActorType[];
  /**
   * Staff role groups allowed to perform it (checked for USER actors only;
   * ADMIN always passes). Omitted = any staff role.
   */
  roles?: string[];
  /** Business precondition — throws GuardFailedError to reject. */
  guard?: (ctx: TransitionContext<TRecord>) => void | Promise<void>;
}

export interface MachineDef<TRecord> {
  /** Audit entity name, e.g. EMPLOYEE, ASSET_FORM. */
  key: string;
  transitions: TransitionDef<TRecord>[];
}

/** Sync status→roles lookup (system-managed ownership overrides). */
export interface OwnershipLookup {
  rolesFor(processKey: string, status: string): string[] | undefined;
}

export interface EngineDeps<TRecord> {
  getId: (record: TRecord) => string;
  getStatus: (record: TRecord) => string;
  /**
   * Optional ownership overrides: when a row exists for (machine, from
   * status) it REPLACES the transition's hardcoded `roles`.
   */
  ownership?: OwnershipLookup;
  /**
   * Guarded persistence: move id from → to ONLY if still in `from`
   * (updateMany pattern). Returns false when the record changed underneath.
   */
  move: (record: TRecord, from: string, to: string) => Promise<boolean>;
  /** Append-only audit write — same transaction as `move` when composed. */
  audit: (entry: AuditEntry) => Promise<unknown>;
  /** Optional timeline anchor stamped onto every audit row. */
  anchors?: (record: TRecord) => { employeeId?: string };
}

export interface TransitionResult {
  from: string;
  to: string;
  action: string;
}

/**
 * Generic state-machine executor. One instance per machine definition.
 *
 * transition() is the ONLY way a status changes:
 *   1. resolve the edge for (current status, action) — else IllegalTransition
 *   2. check the actor type is allowed — else ForbiddenActor
 *   3. run the business guard — it throws GuardFailedError to reject
 *   4. persist with the guarded move — a lost race throws StaleTransition
 *   5. append the audit entry
 */
export class Workflow<TRecord> {
  constructor(
    private readonly def: MachineDef<TRecord>,
    private readonly deps: EngineDeps<TRecord>,
  ) {}

  /** Actions available from a status for an actor — drives UI buttons. */
  availableActions(status: string, actor: Actor): string[] {
    return this.def.transitions
      .filter((t) => t.from === status && t.actors.includes(actor.type))
      .filter((t) => this.roleAllowed(t, actor))
      .map((t) => t.action);
  }

  private roleAllowed(def: TransitionDef<TRecord>, actor: Actor): boolean {
    if (actor.type !== 'USER' || actor.role === 'ADMIN') return true;
    const roles = this.deps.ownership?.rolesFor(this.def.key, def.from) ?? def.roles;
    if (!roles) return true;
    return roles.includes(actor.role ?? '');
  }

  async transition(
    record: TRecord,
    action: string,
    actor: Actor,
    metadata?: AuditEntry['metadata'],
  ): Promise<TransitionResult> {
    const from = this.deps.getStatus(record);
    const def = this.def.transitions.find((t) => t.from === from && t.action === action);
    if (!def) throw new IllegalTransitionError(this.def.key, from, action);
    if (!def.actors.includes(actor.type)) {
      throw new ForbiddenActorError(this.def.key, action, actor.type);
    }
    if (!this.roleAllowed(def, actor)) {
      throw new ForbiddenActorError(this.def.key, action, `role ${actor.role ?? 'unknown'}`);
    }

    const ctx: TransitionContext<TRecord> = { record, actor };
    if (def.guard) await def.guard(ctx);

    const to = typeof def.to === 'function' ? await def.to(ctx) : def.to;
    const id = this.deps.getId(record);

    const moved = await this.deps.move(record, from, to);
    if (!moved) throw new StaleTransitionError(this.def.key, id, from, to);

    await this.deps.audit({
      entity: this.def.key,
      entityId: id,
      action,
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      ...(actor.type === 'USER' && actor.id ? { actorId: actor.id } : {}),
      ...this.deps.anchors?.(record),
      ...(metadata ? { metadata } : {}),
    });

    return { from, to, action };
  }
}
