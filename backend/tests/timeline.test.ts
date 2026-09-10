/**
 * The timeline answers two questions HR kept asking of it: who did this,
 * and who got the email. Audit rows carry the actor's name; email rows carry
 * the recipient. In-app copies stay out, or every staff email would appear
 * twice.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/common/prisma.js';
import { EmployeeRepository } from '../src/modules/employees/employee.repository.js';

const T = (iso: string) => new Date(iso);

function makeDb() {
  const auditLog = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'a1', at: T('2026-09-10T12:00:00Z'), entity: 'EMPLOYEE', action: 'STATUS_TRANSITION',
        fromStatus: 'CREATED', toStatus: 'AWAITING_FORM', actorType: 'USER',
        actor: { name: 'Basma Kamal' },
      },
      {
        id: 'a2', at: T('2026-09-10T09:00:00Z'), entity: 'EMPLOYEE', action: 'LINK_SENT',
        fromStatus: null, toStatus: null, actorType: 'SYSTEM', actor: null,
      },
    ]),
    count: vi.fn().mockResolvedValue(2),
  };
  const notification = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: 'n1', createdAt: T('2026-09-10T10:59:00Z'), sentAt: T('2026-09-10T11:00:00Z'),
        subject: 'Complete your data form', templateKey: 'employee.form_invite', status: 'SENT',
        recipientEmail: 'nora@example.com', recipient: null,
      },
      {
        id: 'n2', createdAt: T('2026-09-10T08:00:00Z'), sentAt: null,
        subject: 'A new hire is waiting', templateKey: 'staff.record_stalled', status: 'FAILED',
        recipientEmail: 'hr@riyada-ksa.com', recipient: { name: 'HR Officer' },
      },
    ]),
    count: vi.fn().mockResolvedValue(2),
  };
  return { db: { auditLog, notification } as unknown as Db, auditLog, notification };
}

describe('EmployeeRepository.timelinePage', () => {
  it('weaves what happened and what was sent into one list, newest first', async () => {
    const { db } = makeDb();
    const { items, total } = await new EmployeeRepository(db).timelinePage('e1', 1, 20);

    expect(items.map((i) => i.id)).toEqual(['a1', 'n1', 'a2', 'n2']);
    expect(total).toBe(4);
  });

  it('names the staff member who acted, and leaves the name empty for the system', async () => {
    const { db } = makeDb();
    const { items } = await new EmployeeRepository(db).timelinePage('e1', 1, 20);

    expect(items[0]).toMatchObject({ kind: 'AUDIT', actorName: 'Basma Kamal', actorType: 'USER' });
    expect(items[2]).toMatchObject({ kind: 'AUDIT', actorName: null, actorType: 'SYSTEM' });
  });

  it('carries the recipient and the delivery outcome of each email', async () => {
    const { db } = makeDb();
    const { items } = await new EmployeeRepository(db).timelinePage('e1', 1, 20);

    expect(items[1]).toMatchObject({
      kind: 'EMAIL',
      recipientEmail: 'nora@example.com',
      recipientName: null,
      deliveryStatus: 'SENT',
    });
    // A queued row has no sentAt: it is placed by when it was created.
    expect(items[3]).toMatchObject({ recipientName: 'HR Officer', deliveryStatus: 'FAILED' });
    expect(items[3]?.at).toEqual(T('2026-09-10T08:00:00Z'));
  });

  it('asks only for emails — the in-app copy of every staff message stays out', async () => {
    const { db, notification } = makeDb();
    await new EmployeeRepository(db).timelinePage('e1', 1, 20);

    expect(notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity: 'EMPLOYEE', entityId: 'e1', channel: 'EMAIL' },
      }),
    );
  });

  it('reads down to the requested page, then returns that slice', async () => {
    const { db, auditLog } = makeDb();
    const { items } = await new EmployeeRepository(db).timelinePage('e1', 2, 2);

    expect(auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(items.map((i) => i.id)).toEqual(['a2', 'n2']);
  });
});
