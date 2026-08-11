import { createWriteStream, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { resolve } from 'node:path';
import { once } from 'node:events';
import type { PrismaClient } from '../generated/prisma/client.js';
import { uploadRoot } from '../common/storage.js';
import { logger } from '../common/logger.js';

// Retention windows. Deliberately conservative — nothing here touches a
// record younger than its window, and audit rows are archived to disk
// BEFORE they are deleted.
const AUDIT_ARCHIVE_DAYS = 365;
const NOTIFICATION_RETENTION_DAYS = 90;
const LINK_TOKEN_RETENTION_DAYS = 30;
const SLA_FIRING_RETENTION_DAYS = 180;
const BATCH = 5_000;

export interface RetentionReport {
  auditArchived: number;
  notificationsPurged: number;
  linkTokensPurged: number;
  slaFiringsPurged: number;
  archiveFile: string | null;
}

/**
 * Nightly housekeeping for the tables that otherwise grow forever. Runs in
 * the worker's maintenance job; `npm run retention` runs it once by hand
 * (the option for setups without Redis).
 */
export class RetentionService {
  constructor(private readonly prisma: PrismaClient) {}

  async run(now: Date = new Date()): Promise<RetentionReport> {
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

    const { archived, archiveFile } = await this.archiveAuditLogs(daysAgo(AUDIT_ARCHIVE_DAYS));

    const [notifications, tokens, firings] = await Promise.all([
      // Only READ in-app rows and delivered/failed emails leave; unread
      // bell items stay regardless of age.
      this.prisma.notification.deleteMany({
        where: {
          createdAt: { lt: daysAgo(NOTIFICATION_RETENTION_DAYS) },
          OR: [
            { channel: 'IN_APP', readAt: { not: null } },
            { channel: 'EMAIL', status: { in: ['SENT', 'FAILED'] } },
          ],
        },
      }),
      // Tokens dead for a month have no forensic value left.
      this.prisma.linkToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: daysAgo(LINK_TOKEN_RETENTION_DAYS) } }, { usedAt: { lt: daysAgo(LINK_TOKEN_RETENTION_DAYS) } }],
        },
      }),
      // The scheduler only consults recent firings (dailies re-fire within
      // a day); half a year of memory is plenty.
      this.prisma.slaFiring.deleteMany({
        where: { firedAt: { lt: daysAgo(SLA_FIRING_RETENTION_DAYS) } },
      }),
    ]);

    const report: RetentionReport = {
      auditArchived: archived,
      notificationsPurged: notifications.count,
      linkTokensPurged: tokens.count,
      slaFiringsPurged: firings.count,
      archiveFile,
    };
    logger.info(report, 'retention run complete');
    return report;
  }

  /**
   * Audit rows older than the cutoff move to a gzipped JSONL file under
   * storage/archive/ (one file per run), then leave the table — the trail
   * survives forever, just not in the hot path.
   */
  private async archiveAuditLogs(
    cutoff: Date,
  ): Promise<{ archived: number; archiveFile: string | null }> {
    const total = await this.prisma.auditLog.count({ where: { at: { lt: cutoff } } });
    if (total === 0) return { archived: 0, archiveFile: null };

    const dir = resolve(uploadRoot, 'archive');
    mkdirSync(dir, { recursive: true });
    const filename = `audit-${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl.gz`;
    const gzip = createGzip();
    const sink = createWriteStream(resolve(dir, filename));
    gzip.pipe(sink);

    let archived = 0;
    for (;;) {
      // Oldest-first batches; rows are deleted as they are safely written,
      // so the loop never revisits them.
      const rows = await this.prisma.auditLog.findMany({
        where: { at: { lt: cutoff } },
        orderBy: { at: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!gzip.write(JSON.stringify(row) + '\n')) await once(gzip, 'drain');
      }
      await this.prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      archived += rows.length;
    }

    gzip.end();
    await once(sink, 'finish');
    return { archived, archiveFile: `archive/${filename}` };
  }
}
