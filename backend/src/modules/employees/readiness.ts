/**
 * "Is this person ready to work and be paid?" — one checklist used by the
 * employee file today, and by attendance (Phase D) and payroll (Phase E)
 * before they accept someone. Accepting an offer is not starting work:
 * every REQUIRED item must hold.
 *
 * Items marked `soon` belong to modules not built yet (work schedule,
 * salary); they are shown so HR sees the full picture, but do not count
 * until their module exists.
 */
export type ReadinessKey =
  | 'EMPLOYED'
  | 'HIRE_DATE'
  | 'CONTRACT'
  | 'UNIT'
  | 'POSITION'
  | 'MANAGER'
  | 'NATIONAL_ID'
  | 'IBAN'
  | 'SCHEDULE'
  | 'SALARY';

export interface ReadinessItem {
  key: ReadinessKey;
  ok: boolean;
  /** Required items block readiness; the others are advice. */
  required: boolean;
  /** Part of a module that is not built yet — shown, not counted. */
  soon?: boolean;
}

export interface ReadinessInput {
  status: string;
  hireDate: Date | null;
  orgUnitId: string | null;
  positionId: string | null;
  managerId: string | null;
  nationalId: string | null;
  iban: string | null;
  contract: { status: string } | null;
  /** A work schedule in force today (Phase C). Undefined = not checked. */
  hasSchedule?: boolean;
  /** Pay with a basic salary in force today (Phase E). Undefined = not checked. */
  hasPay?: boolean;
}

export function readinessOf(e: ReadinessInput): { ready: boolean; items: ReadinessItem[] } {
  const items: ReadinessItem[] = [
    { key: 'EMPLOYED', ok: e.status === 'ACTIVE', required: true },
    { key: 'HIRE_DATE', ok: !!e.hireDate, required: true },
    { key: 'CONTRACT', ok: e.contract?.status === 'ACTIVE', required: true },
    { key: 'UNIT', ok: !!e.orgUnitId, required: true },
    { key: 'POSITION', ok: !!e.positionId, required: true },
    { key: 'NATIONAL_ID', ok: !!e.nationalId?.trim(), required: true },
    { key: 'IBAN', ok: !!e.iban?.trim(), required: true },
    { key: 'MANAGER', ok: !!e.managerId, required: false },
    e.hasSchedule === undefined
      ? { key: 'SCHEDULE', ok: false, required: true, soon: true }
      : { key: 'SCHEDULE', ok: e.hasSchedule, required: true },
    e.hasPay === undefined
      ? { key: 'SALARY', ok: false, required: true, soon: true }
      : { key: 'SALARY', ok: e.hasPay, required: true },
  ];
  const ready = items.every((i) => i.ok || !i.required || i.soon);
  return { ready, items };
}
