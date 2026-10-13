/**
 * Legacy → multi-company mapping plan (Phase 2). Pure planning over the
 * rows the script reads — nothing is guessed: an exact department / title
 * match links; anything else is listed for review.
 */
import { describe, expect, it } from 'vitest';
import { codeOf, planMapping, type MappingInput } from '../scripts/migrate-multi-company.js';

const ROLES = [
  { id: 'r-sa', code: 'SUPER_ADMIN' },
  { id: 'r-hr', code: 'HR' },
  { id: 'r-it', code: 'IT' },
];

function input(over: Partial<MappingInput> = {}): MappingInput {
  return {
    companyId: 'NEW',
    employees: [],
    users: [],
    assets: [],
    roles: ROLES,
    existingUnits: {},
    existingPositions: {},
    ...over,
  };
}

describe('codeOf', () => {
  it('turns a label into a stable upper-case code', () => {
    expect(codeOf('Customer Service')).toBe('CUSTOMER_SERVICE');
    expect(codeOf('  it  ')).toBe('IT');
    expect(codeOf('R&D - Core')).toBe('RD_CORE');
  });
  it('gives Arabic-only labels a stable hashed code instead of an empty one', () => {
    const a = codeOf('خدمة العملاء');
    expect(a).toMatch(/^UNIT_[0-9A-F]+$/);
    expect(codeOf('خدمة العملاء')).toBe(a);
    expect(codeOf('المالية')).not.toBe(a);
  });
});

describe('planMapping', () => {
  it('assigns every unmapped employee and asset, and builds units/positions from exact values', () => {
    const plan = planMapping(
      input({
        employees: [
          { id: 'e1', companyId: null, department: 'IT', jobTitle: 'Engineer', orgUnitId: null, positionId: null },
          { id: 'e2', companyId: null, department: 'IT', jobTitle: 'Engineer', orgUnitId: null, positionId: null },
          { id: 'e3', companyId: null, department: 'Finance', jobTitle: null, orgUnitId: null, positionId: null },
        ],
        assets: [{ id: 'a1', companyId: null }],
      }),
    );
    expect(plan.employeesToAssign).toEqual(['e1', 'e2', 'e3']);
    expect(plan.assetsToAssign).toEqual(['a1']);
    expect(plan.unitsToCreate).toEqual([
      { code: 'IT', name: 'IT' },
      { code: 'FINANCE', name: 'Finance' },
    ]);
    expect(plan.positionsToCreate).toEqual([{ code: 'ENGINEER', title: 'Engineer' }]);
    expect(plan.employeeUnit).toEqual({ e1: 'IT', e2: 'IT', e3: 'FINANCE' });
    expect(plan.employeePosition).toEqual({ e1: 'ENGINEER', e2: 'ENGINEER' });
    // e3 has no title — reported, not guessed.
    expect(plan.review.employeesWithoutJobTitle).toEqual(['e3']);
    expect(plan.review.employeesWithoutDepartment).toEqual([]);
  });

  it('leaves records that already belong to ANOTHER company untouched', () => {
    const plan = planMapping(
      input({
        companyId: 'c-riyada',
        employees: [
          { id: 'e-other', companyId: 'c-other', department: 'IT', jobTitle: 'X', orgUnitId: null, positionId: null },
        ],
        assets: [{ id: 'a-other', companyId: 'c-other' }],
      }),
    );
    expect(plan.employeesToAssign).toEqual([]);
    expect(plan.assetsToAssign).toEqual([]);
    expect(plan.unitsToCreate).toEqual([]);
    expect(plan.employeeUnit).toEqual({});
  });

  it('is idempotent: existing units/positions are reused and already-linked employees are skipped', () => {
    const plan = planMapping(
      input({
        companyId: 'c1',
        employees: [
          { id: 'e1', companyId: 'c1', department: 'IT', jobTitle: 'Engineer', orgUnitId: 'u-it', positionId: 'p-eng' },
          { id: 'e2', companyId: 'c1', department: 'IT', jobTitle: 'Engineer', orgUnitId: null, positionId: null },
        ],
        existingUnits: { IT: 'u-it' },
        existingPositions: { ENGINEER: 'p-eng' },
      }),
    );
    expect(plan.employeesToAssign).toEqual([]);
    expect(plan.unitsToCreate).toEqual([]);
    expect(plan.positionsToCreate).toEqual([]);
    expect(plan.employeeUnit).toEqual({ e2: 'IT' });
    expect(plan.employeePosition).toEqual({ e2: 'ENGINEER' });
  });

  it('maps staff: ADMIN → global SUPER_ADMIN, others → the same role in the company; unknown roles reviewed', () => {
    const plan = planMapping(
      input({
        users: [
          { id: 'u-admin', email: 'admin@x', role: 'ADMIN', assignmentCount: 0 },
          { id: 'u-hr', email: 'hr@x', role: 'HR', assignmentCount: 0 },
          { id: 'u-fin', email: 'fin@x', role: 'FINANCE', assignmentCount: 0 },
          { id: 'u-done', email: 'done@x', role: 'HR', assignmentCount: 1 },
        ],
      }),
    );
    expect(plan.assignments).toEqual([
      { userId: 'u-admin', roleCode: 'SUPER_ADMIN', global: true },
      { userId: 'u-hr', roleCode: 'HR', global: false },
    ]);
    // FINANCE is not in the (test) role table → reported, never silently dropped.
    expect(plan.review.usersWithUnknownRole).toEqual([{ id: 'u-fin', role: 'FINANCE' }]);
    expect(plan.review.usersAlreadyAssigned).toEqual(['u-done']);
  });
});
