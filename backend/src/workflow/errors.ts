/**
 * Typed domain errors. The central error handler (Phase E) maps these to
 * HTTP responses; until then they make service/test failures precise.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
}

/** No transition defined for (status, action) in this machine. */
export class IllegalTransitionError extends DomainError {
  readonly code = 'ILLEGAL_TRANSITION';
  readonly httpStatus = 409;
  constructor(machine: string, from: string, action: string) {
    super(`${machine}: no transition for action "${action}" from status "${from}"`);
  }
}

/** The transition exists but this actor type/role may not perform it. */
export class ForbiddenActorError extends DomainError {
  readonly code = 'FORBIDDEN_ACTOR';
  readonly httpStatus = 403;
  constructor(machine: string, action: string, actor: string) {
    super(`${machine}: actor "${actor}" may not perform "${action}"`);
  }
}

/** A business guard rejected the transition (e.g. missing documents). */
export class GuardFailedError extends DomainError {
  readonly code: string;
  readonly httpStatus = 422;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The record was no longer in the expected status when the write landed —
 * a concurrent request (double-click, retry) won the race. Safe to surface
 * as a conflict; nothing was corrupted.
 */
export class StaleTransitionError extends DomainError {
  readonly code = 'STALE_TRANSITION';
  readonly httpStatus = 409;
  constructor(machine: string, id: string, from: string, to: string) {
    super(`${machine} ${id}: expected status "${from}" for move to "${to}", but it changed`);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
  }
}
