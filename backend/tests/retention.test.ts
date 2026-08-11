/**
 * Retention — purge windows target exactly the right rows, and audit rows
 * are archived (written out) before they are deleted.
 */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RetentionService } from '../src/maintenance/retention.js';
import { uploadRoot } from '../src/common/storage.js';

const NOW = new Date('2026-08-11T12:00:00Z');
const archiveDir = resolve(uploadRoot, 'archive');

afterAll(() => rmSync(archiveDir, { recursive: true, force: true }));

function makePrisma(auditRows: Array<{ id: string; at: Date }> = []) {
  let remaining = [...auditRows];
  return {
    auditLog: {
      count: vi.fn().mockImplementation(() => Promise.resolve(remaining.length)),
      findMany: vi.fn().mockImplementation(() => Promise.resolve(remaining.slice(0, 5000))),
      deleteMany: vi.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
        remaining = remaining.filter((r) => !where.id.in.includes(r.id));
        return Promise.resolve({ count: where.id.in.length });
      }),
    },
    notification: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    linkToken: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    slaFiring: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) },
  };
}

describe('RetentionService', () => {
  it('purges only read/delivered notifications, dead tokens, old firings', async () => {
    const prisma = makePrisma();
    const report = await new RetentionService(prisma as never).run(NOW);

    expect(report).toMatchObject({
      auditArchived: 0,
      notificationsPurged: 3,
      linkTokensPurged: 2,
      slaFiringsPurged: 7,
      archiveFile: null,
    });

    const notifWhere = prisma.notification.deleteMany.mock.calls[0]![0].where;
    // Unread bell items must survive: the IN_APP arm requires readAt set.
    expect(notifWhere.OR[0]).toEqual({ channel: 'IN_APP', readAt: { not: null } });
    expect(notifWhere.createdAt.lt).toEqual(new Date('2026-05-13T12:00:00Z')); // 90 days

    const firingWhere = prisma.slaFiring.deleteMany.mock.calls[0]![0].where;
    expect(firingWhere.firedAt.lt).toEqual(new Date('2026-02-12T12:00:00Z')); // 180 days
  });

  it('archives old audit rows to a gzip file BEFORE deleting them', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const prisma = makePrisma([
      { id: 'a1', at: old },
      { id: 'a2', at: old },
    ]);
    const report = await new RetentionService(prisma as never).run(NOW);

    expect(report.auditArchived).toBe(2);
    expect(report.archiveFile).toMatch(/^archive\/audit-.*\.jsonl\.gz$/);
    expect(existsSync(resolve(uploadRoot, report.archiveFile as string))).toBe(true);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] } },
    });
  });
});
