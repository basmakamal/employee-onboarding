/**
 * "Also send a copy to": extra addresses on a trigger or an automation rule
 * each receive their own copy of the staff message, and can be removed again.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { TriggerService, splitCc } from '../src/notifications/trigger.service.js';
import type { TransitionEvent } from '../src/workflow/engine.js';

const event: TransitionEvent = {
  entity: 'EMPLOYEE', entityId: 'e1', action: 'SUBMIT_FORM', from: 'AWAITING_FORM', to: 'FORM_RECEIVED', actorType: 'LINK',
};

function setup(trigger: Record<string, unknown>) {
  const prisma = {
    emailTrigger: {
      findMany: vi.fn().mockResolvedValue([trigger]),
      findUnique: vi.fn().mockResolvedValue(trigger),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...trigger, ...data }),
      ),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't-new', ...data }),
      ),
    },
    employee: {
      findUnique: vi.fn().mockResolvedValue({
        firstName: 'Sara', lastName: 'Ali', email: 'sara@example.com', employeeNo: null, department: null, jobTitle: null,
      }),
    },
  };
  const notifications = { notifyExternal: vi.fn(), notifyRole: vi.fn() };
  const service = new TriggerService(prisma as unknown as PrismaClient, notifications as unknown as NotificationService);
  return { service, prisma, notifications };
}

const base = {
  id: 't1', processKey: 'EMPLOYEE', status: 'FORM_RECEIVED', templateKey: 'custom.status_change',
  recipient: 'ROLE', role: 'HR', active: true, ccEmails: 'basma@riyada-ksa.com, Admin@Riyada-KSA.com',
};

describe('trigger copies', () => {
  it('the group gets the message and every cc address gets its own copy', async () => {
    const { service, notifications } = setup(base);
    await service.handle(event);
    expect(notifications.notifyRole).toHaveBeenCalledWith('HR', 'custom.status_change', expect.anything(), expect.anything());
    expect(notifications.notifyExternal).toHaveBeenCalledTimes(2);
    expect(notifications.notifyExternal).toHaveBeenCalledWith('basma@riyada-ksa.com', 'custom.status_change', expect.anything(), expect.anything());
    expect(notifications.notifyExternal).toHaveBeenCalledWith('admin@riyada-ksa.com', 'custom.status_change', expect.anything(), expect.anything());
  });

  it('create stores a clean, de-duplicated list; update can clear it', async () => {
    const { service, prisma } = setup(base);
    await service.create({
      processKey: 'EMPLOYEE', status: 'FORM_RECEIVED', templateKey: 'custom.status_change', recipient: 'ROLE', role: 'HR',
      ccEmails: [' Basma@riyada-ksa.com', 'basma@riyada-ksa.com', ''],
    });
    expect((prisma.emailTrigger.create.mock.calls[0]?.[0] as { data: { ccEmails: string } }).data.ccEmails).toBe('basma@riyada-ksa.com');

    await service.update('t1', { ccEmails: [] });
    expect((prisma.emailTrigger.update.mock.calls[0]?.[0] as { data: { ccEmails: string | null } }).data.ccEmails).toBeNull();
  });

  it('an update that does not mention cc keeps the existing list', async () => {
    const { service, prisma } = setup(base);
    await service.update('t1', { active: false });
    expect((prisma.emailTrigger.update.mock.calls[0]?.[0] as { data: { ccEmails: string } }).data.ccEmails).toBe(
      'basma@riyada-ksa.com,admin@riyada-ksa.com',
    );
  });

  it('splitCc tolerates spaces, case and empties', () => {
    expect(splitCc(' A@x.com, ,b@Y.com ')).toEqual(['a@x.com', 'b@y.com']);
    expect(splitCc(null)).toEqual([]);
  });
});
