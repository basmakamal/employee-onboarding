/** The "ready to work and be paid" checklist. */
import { describe, expect, it } from 'vitest';
import { readinessOf } from '../src/modules/employees/readiness.js';

const complete = {
  status: 'ACTIVE',
  hireDate: new Date('2026-01-01'),
  orgUnitId: 'u1',
  positionId: 'p1',
  managerId: null,
  nationalId: '1012345678',
  iban: 'SA0380000000608010167519',
  contract: { status: 'ACTIVE' },
  account: null,
};

describe('readiness', () => {
  it('is ready when every required item holds (advice items and future modules do not block)', () => {
    const r = readinessOf(complete);
    expect(r.ready).toBe(true);
    expect(r.items.find((i) => i.key === 'MANAGER')).toMatchObject({ ok: false, required: false });
    expect(r.items.find((i) => i.key === 'SALARY')).toMatchObject({ soon: true });
  });

  it.each([
    ['not yet active', { status: 'AWAITING_CONTRACT_APPROVAL' }, 'EMPLOYED'],
    ['contract not active', { contract: { status: 'PENDING_APPROVAL' } }, 'CONTRACT'],
    ['no IBAN for the salary', { iban: '  ' }, 'IBAN'],
    ['not placed in a unit', { orgUnitId: null }, 'UNIT'],
  ])('is not ready when %s', (_label, patch, key) => {
    const r = readinessOf({ ...complete, ...patch });
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === key)?.ok).toBe(false);
  });
});
