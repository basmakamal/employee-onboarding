/**
 * The dropdown lists: every company owns its own copy. Fixed lists keep
 * their codes, open lists grow — from the admin screen or from a value typed
 * in a form — and seeding only ever fills gaps.
 */
import { describe, expect, it, vi } from 'vitest';
import { ListService } from '../src/modules/lists/list.service.js';
import { GuardFailedError, NotFoundError } from '../src/workflow/errors.js';

interface Row {
  id: string;
  companyId: string;
  list: string;
  code: string;
  labelAr: string;
  labelEn: string;
  sortOrder: number;
  active: boolean;
  system: boolean;
}

const A = 'company-a';
const B = 'company-b';

/** An in-memory stand-in for the repository, enough to exercise the rules. */
function fakeRepo(seed: Row[] = [], companies: string[] = [A, B]) {
  const rows: Row[] = [...seed];
  let n = 0;
  return {
    rows,
    companyIds: vi.fn(async () => [...companies]),
    firstCompanyId: vi.fn(async () => companies[0] ?? null),
    listAll: vi.fn(async (companyId: string) => rows.filter((r) => r.companyId === companyId)),
    find: vi.fn(
      async (companyId: string, list: string, code: string) =>
        rows.find((r) => r.companyId === companyId && r.list === list && r.code === code) ?? null,
    ),
    findById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    create: vi.fn(async (data: Omit<Row, 'id'>) => {
      if (rows.some((r) => r.companyId === data.companyId && r.list === data.list && r.code === data.code)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
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
    lastSortOrder: vi.fn(async (companyId: string, list: string) =>
      rows.filter((r) => r.companyId === companyId && r.list === list).reduce((m, r) => Math.max(m, r.sortOrder), -1),
    ),
    distinctEmployeeValues: vi.fn(async (companyId: string) =>
      companyId === A
        ? { departments: ['IT', 'Finance'], jobTitles: ['Engineer'], projects: [] }
        : { departments: [], jobTitles: [], projects: [] },
    ),
  };
}

const ofCompany = (rows: Row[], companyId: string) => rows.filter((r) => r.companyId === companyId);

describe('ListService', () => {
  it('seeds the whole catalogue into every company, plus each company’s own typed values, once', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);

    await svc.ensureDefaults();
    const first = repo.rows.length;
    for (const c of [A, B]) {
      expect(ofCompany(repo.rows, c).some((r) => r.list === 'GENDER' && r.code === 'MALE' && r.system)).toBe(true);
      expect(ofCompany(repo.rows, c).some((r) => r.list === 'EMPLOYEE_STATUS' && r.code === 'WITHDRAWN')).toBe(true);
    }
    // Departments typed on company A's employees stay in company A.
    expect(ofCompany(repo.rows, A).some((r) => r.list === 'DEPARTMENT' && r.code === 'IT' && !r.system)).toBe(true);
    expect(ofCompany(repo.rows, B).some((r) => r.list === 'DEPARTMENT' && r.code === 'IT')).toBe(false);

    // An admin's translation survives the next boot.
    repo.rows.find((r) => r.companyId === A && r.list === 'ROLE' && r.code === 'HR')!.labelAr = 'شؤون الموظفين';
    await svc.ensureDefaults();
    expect(repo.rows.length).toBe(first);
    expect(repo.rows.find((r) => r.companyId === A && r.list === 'ROLE' && r.code === 'HR')!.labelAr).toBe('شؤون الموظفين');
  });

  it('a company added later is seeded on its first read', async () => {
    const repo = fakeRepo([], []);
    const svc = new ListService(repo as never);

    const lists = await svc.all('company-new');
    expect(lists.find((l) => l.key === 'GENDER')!.values.map((v) => v.code)).toEqual(['MALE', 'FEMALE']);
    expect(ofCompany(repo.rows, 'company-new').length).toBeGreaterThan(0);
  });

  it('a rename in one company does not touch the other', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);
    await svc.ensureDefaults();

    const maleA = repo.rows.find((r) => r.companyId === A && r.list === 'GENDER' && r.code === 'MALE')!;
    await svc.update(A, 'GENDER', maleA.id, { labelEn: 'Man' });

    const genderB = (await svc.all(B)).find((l) => l.key === 'GENDER')!;
    expect(genderB.values.find((v) => v.code === 'MALE')!.labelEn).toBe('Male');
    const genderA = (await svc.all(A)).find((l) => l.key === 'GENDER')!;
    expect(genderA.values.find((v) => v.code === 'MALE')!.labelEn).toBe('Man');

    // Company B cannot edit or delete company A's row through its own workspace.
    await expect(svc.update(B, 'GENDER', maleA.id, { labelEn: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.remove(B, 'GENDER', maleA.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a typed value joins its company’s open list once, with the text as both labels', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);
    await svc.ensureDefaults();
    const before = repo.rows.length;

    await svc.ensureValue(B, 'DEPARTMENT', ' Customer Care ');
    await svc.ensureValue(B, 'DEPARTMENT', 'Customer Care');
    await svc.ensureValue(B, 'DEPARTMENT', '');
    await svc.ensureValue(null, 'DEPARTMENT', 'No company');
    // Fixed lists ignore typing: a code the enum does not know cannot be stored anyway.
    await svc.ensureValue(B, 'GENDER', 'OTHER');

    expect(repo.rows.length).toBe(before + 1);
    const added = ofCompany(repo.rows, B).filter((r) => r.list === 'DEPARTMENT');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ code: 'Customer Care', labelAr: 'Customer Care', labelEn: 'Customer Care' });
    expect(ofCompany(repo.rows, A).some((r) => r.code === 'Customer Care')).toBe(false);
  });

  it('fixed lists accept new labels and order, never new or removed codes', async () => {
    const repo = fakeRepo([
      { id: 'g1', companyId: A, list: 'GENDER', code: 'MALE', labelAr: 'ذكر', labelEn: 'Male', sortOrder: 0, active: true, system: true },
    ]);
    const svc = new ListService(repo as never);

    await svc.update(A, 'GENDER', 'g1', { labelEn: 'Man', sortOrder: 3 });
    expect(repo.rows[0]).toMatchObject({ labelEn: 'Man', sortOrder: 3 });

    await expect(svc.create(A, 'GENDER', { labelAr: 'x', labelEn: 'Other' })).rejects.toBeInstanceOf(GuardFailedError);
    await expect(svc.update(A, 'GENDER', 'g1', { active: false })).rejects.toBeInstanceOf(GuardFailedError);
    await expect(svc.remove(A, 'GENDER', 'g1')).rejects.toBeInstanceOf(GuardFailedError);
  });

  it('open lists grow from the admin screen and shrink again; duplicates are refused per company', async () => {
    const repo = fakeRepo();
    const svc = new ListService(repo as never);
    await svc.ensureDefaults();

    const row = await svc.create(A, 'ASSET_TYPE', { labelAr: 'طابعة', labelEn: 'Printer' });
    expect(row).toMatchObject({ code: 'Printer', labelAr: 'طابعة', labelEn: 'Printer', companyId: A });
    await expect(svc.create(A, 'ASSET_TYPE', { labelAr: 'أخرى', labelEn: 'Printer' })).rejects.toThrow(/already/);
    // The same value is fine in the other company.
    await expect(svc.create(B, 'ASSET_TYPE', { labelAr: 'طابعة', labelEn: 'Printer' })).resolves.toMatchObject({ companyId: B });

    await svc.update(A, 'ASSET_TYPE', row.id, { active: false });
    expect(await svc.codes(A, 'ASSET_TYPE')).not.toContain('Printer');
    expect(await svc.codes(B, 'ASSET_TYPE')).toContain('Printer');

    await svc.remove(A, 'ASSET_TYPE', row.id);
    expect(repo.rows.some((r) => r.id === row.id)).toBe(false);
  });

  it('the public form sees its company’s own lists, active values only', async () => {
    const repo = fakeRepo([
      { id: 'n1', companyId: A, list: 'NATIONALITY', code: 'SA', labelAr: 'سعودي', labelEn: 'Saudi', sortOrder: 0, active: true, system: false },
      { id: 'n2', companyId: A, list: 'NATIONALITY', code: 'XX', labelAr: 'x', labelEn: 'x', sortOrder: 1, active: false, system: false },
      { id: 'n3', companyId: B, list: 'NATIONALITY', code: 'EG', labelAr: 'مصري', labelEn: 'Egyptian', sortOrder: 0, active: true, system: false },
      { id: 'd1', companyId: A, list: 'DEPARTMENT', code: 'IT', labelAr: 'IT', labelEn: 'IT', sortOrder: 0, active: true, system: false },
    ]);
    const svc = new ListService(repo as never);

    const pub = await svc.forPublicForm(A);
    const keys = pub.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['GENDER', 'NATIONALITY', 'MARITAL_STATUS', 'QUALIFICATION']));
    expect(keys).not.toContain('DEPARTMENT');
    const nationality = pub.find((l) => l.key === 'NATIONALITY')!;
    expect(nationality.allowOther).toBe(true);
    expect(nationality.values.map((v) => v.code)).toEqual(['SA']);

    expect((await svc.forPublicForm(B)).find((l) => l.key === 'NATIONALITY')!.values.map((v) => v.code)).toEqual(['EG']);
    // A legacy record with no company reads the oldest company's lists.
    expect((await svc.forPublicForm(null)).find((l) => l.key === 'NATIONALITY')!.values.map((v) => v.code)).toEqual(['SA']);
  });
});
