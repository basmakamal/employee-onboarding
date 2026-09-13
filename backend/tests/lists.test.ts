/**
 * The dropdown lists: fixed lists keep their codes, open lists grow — from
 * the admin screen or from a value typed in a form — and boot seeding only
 * ever fills gaps.
 */
import { describe, expect, it, vi } from 'vitest';
import { ListService } from '../src/modules/lists/list.service.js';
import { GuardFailedError } from '../src/workflow/errors.js';

interface Row {
  id: string;
  list: string;
  code: string;
  labelAr: string;
  labelEn: string;
  sortOrder: number;
  active: boolean;
  system: boolean;
}

/** An in-memory stand-in for the repository, enough to exercise the rules. */
function fakeRepo(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let n = 0;
  return {
    rows,
    listAll: vi.fn(async () => [...rows]),
    listByKey: vi.fn(async (list: string) => rows.filter((r) => r.list === list)),
    find: vi.fn(async (list: string, code: string) => rows.find((r) => r.list === list && r.code === code) ?? null),
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    create: vi.fn(async (data: Omit<Row, 'id'>) => {
      const row = { id: `v${++n}`, active: true, system: false, sortOrder: 0, ...data } as Row;
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id: string, data: Partial<Row>) => {
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row, data);
      return row;
    }),
    remove: vi.fn(async (id: string) => {
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    }),
    lastSortOrder: vi.fn(async (list: string) =>
      rows.filter((r) => r.list === list).reduce((m, r) => Math.max(m, r.sortOrder), -1),
    ),
    distinctEmployeeValues: vi.fn(async () => ({ departments: ['IT', 'Finance'], jobTitles: ['Engineer'], projects: [] })),
  };
}

describe('ListService', () => {
  it('seeds every catalogue default plus the values already typed on records, once', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);

    await svc.ensureDefaults();
    const first = repo.rows.length;
    expect(repo.rows.some((r) => r.list === 'GENDER' && r.code === 'MALE' && r.system)).toBe(true);
    expect(repo.rows.some((r) => r.list === 'DEPARTMENT' && r.code === 'IT' && !r.system)).toBe(true);
    expect(repo.rows.some((r) => r.list === 'EMPLOYEE_STATUS' && r.code === 'WITHDRAWN')).toBe(true);

    // An admin's translation survives the next boot.
    repo.rows.find((r) => r.list === 'ROLE' && r.code === 'HR')!.labelAr = 'شؤون الموظفين';
    await svc.ensureDefaults();
    expect(repo.rows.length).toBe(first);
    expect(repo.rows.find((r) => r.list === 'ROLE' && r.code === 'HR')!.labelAr).toBe('شؤون الموظفين');
  });

  it('a typed value joins its open list once, with the text as both labels', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);

    await svc.ensureValue('DEPARTMENT', ' Customer Care ');
    await svc.ensureValue('DEPARTMENT', 'Customer Care');
    await svc.ensureValue('DEPARTMENT', '');
    // Fixed lists ignore typing: a code the enum does not know cannot be stored anyway.
    await svc.ensureValue('GENDER', 'OTHER');

    const added = repo.rows.filter((r) => r.list === 'DEPARTMENT');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ code: 'Customer Care', labelAr: 'Customer Care', labelEn: 'Customer Care' });
    expect(repo.rows.some((r) => r.list === 'GENDER')).toBe(false);
  });

  it('fixed lists accept new labels and order, never new or removed codes', async () => {
    const repo = fakeRepo([
      { id: 'g1', list: 'GENDER', code: 'MALE', labelAr: 'ذكر', labelEn: 'Male', sortOrder: 0, active: true, system: true },
    ]);
    const svc = new ListService(repo as never);

    await svc.update('GENDER', 'g1', { labelEn: 'Man', sortOrder: 3 });
    expect(repo.rows[0]).toMatchObject({ labelEn: 'Man', sortOrder: 3 });

    await expect(svc.create('GENDER', { labelAr: 'x', labelEn: 'Other' })).rejects.toBeInstanceOf(GuardFailedError);
    await expect(svc.update('GENDER', 'g1', { active: false })).rejects.toBeInstanceOf(GuardFailedError);
    await expect(svc.remove('GENDER', 'g1')).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('open lists grow from the admin screen and shrink again; duplicates are refused', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);

    const row = await svc.create('ASSET_TYPE', { labelAr: 'طابعة', labelEn: 'Printer' });
    expect(row).toMatchObject({ code: 'Printer', labelAr: 'طابعة', labelEn: 'Printer' });
    await expect(svc.create('ASSET_TYPE', { labelAr: 'أخرى', labelEn: 'Printer' })).rejects.toThrow(/already/);

    await svc.update('ASSET_TYPE', row.id, { active: false });
    expect(await svc.codes('ASSET_TYPE')).toEqual([]);

    await svc.remove('ASSET_TYPE', row.id);
    expect(repo.rows).toHaveLength(0);
  });

  it('the public form sees only its own lists, active values only', async () => {
    const repo = fakeRepo([
      { id: 'n1', list: 'NATIONALITY', code: 'SA', labelAr: 'سعودي', labelEn: 'Saudi', sortOrder: 0, active: true, system: false },
      { id: 'n2', list: 'NATIONALITY', code: 'XX', labelAr: 'x', labelEn: 'x', sortOrder: 1, active: false, system: false },
      { id: 'd1', list: 'DEPARTMENT', code: 'IT', labelAr: 'IT', labelEn: 'IT', sortOrder: 0, active: true, system: false },
    ]);
    const svc = new ListService(repo as never);

    const pub = await svc.forPublicForm();
    const keys = pub.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['GENDER', 'NATIONALITY', 'MARITAL_STATUS', 'QUALIFICATION']));
    expect(keys).not.toContain('DEPARTMENT');
    const nationality = pub.find((l) => l.key === 'NATIONALITY')!;
    expect(nationality.allowOther).toBe(true);
    expect(nationality.values.map((v) => v.code)).toEqual(['SA']);
  });
});
