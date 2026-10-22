/**
 * Responsible teams: named people (e-mail addresses, optionally linked to
 * accounts) assigned to statuses. Where a status has a team, the team
 * REPLACES the role-wide broadcast; without one, the old behaviour holds.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../src/notifications/notification.service.js';
import { TriggerService } from '../src/notifications/trigger.service.js';

const FUTOON = { id: 'm1', name: 'فتون', email: 'futoon@riyada-ksa.com', userId: null };
const AYMAN_LINKED = { id: 'm2', name: 'أيمن', email: 'ayman@riyada-ksa.com', userId: 'u-ayman' };

function makeService(members: Array<typeof FUTOON> = []) {
  const rows: Array<Record<string, unknown>> = [];
  let n = 0;
  const repo = {
    create: vi.fn().mockImplementation((data: Record<string, unknown>) => {
      const row = { id: `n${++n}`, ...data };
      rows.push(row);
      return Promise.resolve(row);
    }),
    markSent: vi.fn().mockResolvedValue({}),
    markFailed: vi.fn().mockResolvedValue({}),
    findById: vi.fn(),
  };
  const users = {
    listActiveByRole: vi.fn().mockResolvedValue([
      { id: 'u-hr1', email: 'hr1@example.com' },
      { id: 'u-hr2', email: 'hr2@example.com' },
    ]),
    listActiveByIds: vi.fn().mockImplementation((ids: string[]) =>
      Promise.resolve(ids.includes('u-ayman') ? [{ id: 'u-ayman', email: 'ayman@riyada-ksa.com' }] : []),
    ),
  };
  const notifier = { send: vi.fn().mockResolvedValue(undefined) };
  const groups = { membersFor: vi.fn().mockResolvedValue(members) };
  const service = new NotificationService(
    repo as never,
    users as never,
    notifier,
    undefined,
    undefined,
    undefined,
    'https://hr.example',
    groups,
  );
  return { service, rows, notifier, users, groups };
}

describe('NotificationService.notifyTeam', () => {
  it('without a team for the status, the owning role group gets it (unchanged behaviour)', async () => {
    const { service, rows, users, groups } = makeService([]);

    await service.notifyTeam(
      { processKey: 'EMPLOYEE', status: 'FORM_RECEIVED', role: 'HR' },
      'hr.form_submitted',
      { name: 'Nora' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );

    expect(groups.membersFor).toHaveBeenCalledWith('EMPLOYEE', 'FORM_RECEIVED');
    expect(users.listActiveByRole).toHaveBeenCalledWith('HR');
    // Two HR users × (IN_APP + EMAIL).
    expect(rows.filter((r) => r.channel === 'EMAIL').map((r) => r.recipientEmail)).toEqual([
      'hr1@example.com',
      'hr2@example.com',
    ]);
  });

  it('with a team, ONLY the team hears about it — the role broadcast is replaced', async () => {
    const { service, rows, users } = makeService([FUTOON]);

    await service.notifyTeam(
      { processKey: 'EMPLOYEE', status: 'FORM_RECEIVED', role: 'HR', ownerIds: ['u-someone'] },
      'hr.form_submitted',
      { name: 'Nora' },
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );

    expect(users.listActiveByRole).not.toHaveBeenCalled();
    const emails = rows.filter((r) => r.channel === 'EMAIL');
    expect(emails.map((r) => r.recipientEmail)).toEqual(['futoon@riyada-ksa.com']);
    // A team message is staff-facing: it carries the employee-file link.
    expect(String(emails[0]!.body)).toContain('https://hr.example/employees/e1');
    // No account → no bell row.
    expect(rows.some((r) => r.channel === 'IN_APP')).toBe(false);
  });

  it('a member linked to an account gets the bell + e-mail once, not an extra external copy', async () => {
    const { service, rows } = makeService([AYMAN_LINKED, FUTOON]);

    await service.notifyTeam(
      { processKey: 'GOSI', status: 'PENDING', role: 'INSURANCE' },
      'staff.record_stalled',
      { name: 'Nora', status: 'PENDING', daysWaiting: 3 },
      { entity: 'GOSI', entityId: 'g1' },
    );

    const inApp = rows.filter((r) => r.channel === 'IN_APP');
    expect(inApp.map((r) => r.recipientUserId)).toEqual(['u-ayman']);
    const emails = rows.filter((r) => r.channel === 'EMAIL').map((r) => r.recipientEmail);
    expect(emails.sort()).toEqual(['ayman@riyada-ksa.com', 'futoon@riyada-ksa.com']);
  });

  it('named owners still ride along with the role when there is no team', async () => {
    const { service, users } = makeService([]);
    users.listActiveByIds.mockResolvedValue([{ id: 'u-x', email: 'x@example.com' }]);

    await service.notifyTeam(
      { processKey: 'ASSET_FORM', status: 'APPROVED', role: 'IT', ownerIds: ['u-x'] },
      'hr.asset_approved',
      { name: 'Nora' },
      { entity: 'ASSET_FORM', entityId: 'f1' },
    );

    expect(users.listActiveByRole).toHaveBeenCalledWith('IT');
    expect(users.listActiveByIds).toHaveBeenCalledWith(['u-x']);
  });
});

describe('TriggerService — GROUP recipients', () => {
  function makeTriggers(trigger: Record<string, unknown>) {
    const prisma = {
      emailTrigger: {
        findMany: vi.fn().mockResolvedValue([trigger]),
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 't-new', ...data }),
        ),
      },
      employee: {
        findUnique: vi.fn().mockResolvedValue({
          firstName: 'Nora', lastName: 'Khalid', email: 'nora@example.com',
          employeeNo: null, department: null, jobTitle: null, preferredLanguage: 'AR', contract: null,
        }),
      },
    };
    const notifications = {
      notifyExternal: vi.fn().mockResolvedValue(undefined),
      notifyRole: vi.fn().mockResolvedValue(undefined),
      notifyMembers: vi.fn().mockResolvedValue(undefined),
      employeeLink: (id: string) => `https://hr.example/employees/${id}`,
    };
    const groups = {
      list: vi.fn().mockResolvedValue([{ id: 'g1', nameAr: 'عقد العمل', nameEn: 'Employment Contract' }]),
      findById: vi.fn().mockImplementation((id: string) => Promise.resolve(id === 'g1' ? { id } : null)),
      membersOf: vi.fn().mockResolvedValue([AYMAN_LINKED]),
    };
    const service = new TriggerService(prisma as never, notifications as never, undefined, undefined, groups);
    return { service, notifications, groups, prisma };
  }

  it('sends the template to the team members, not to a role', async () => {
    const { service, notifications, groups } = makeTriggers({
      id: 't1', processKey: 'EMPLOYEE', status: 'AWAITING_CONTRACT_APPROVAL',
      templateKey: 'staff.contract_approval_pending', recipient: 'GROUP', role: null, groupId: 'g1',
      ccEmails: null, active: true,
    });

    await service.handle({
      entity: 'EMPLOYEE', entityId: 'e1', action: 'SUBMIT_CONTRACT',
      from: 'CONTRACT_CREATION', to: 'AWAITING_CONTRACT_APPROVAL', actorType: 'USER',
    });

    expect(groups.membersOf).toHaveBeenCalledWith('g1');
    expect(notifications.notifyMembers).toHaveBeenCalledWith(
      [AYMAN_LINKED],
      'staff.contract_approval_pending',
      expect.objectContaining({ name: 'Nora Khalid', employeeLink: 'https://hr.example/employees/e1' }),
      { entity: 'EMPLOYEE', entityId: 'e1' },
    );
    expect(notifications.notifyRole).not.toHaveBeenCalled();
  });

  it('refuses a GROUP trigger that points at no known team', async () => {
    const { service } = makeTriggers({});
    await expect(
      service.create({
        processKey: 'EMPLOYEE', status: 'ACTIVE', templateKey: 'hr.employee_activated',
        recipient: 'GROUP', groupId: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'BAD_GROUP' });
  });

  it('lists the teams for the trigger form', async () => {
    const { service } = makeTriggers({});
    const options = await service.options();
    expect(options.groups).toEqual([{ id: 'g1', nameAr: 'عقد العمل', nameEn: 'Employment Contract' }]);
  });
});
