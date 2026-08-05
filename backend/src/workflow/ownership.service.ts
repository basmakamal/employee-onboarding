import type { PrismaClient } from '../generated/prisma/client.js';
import { logger } from '../common/logger.js';

/**
 * System-managed status ownership: which role group(s) may act on records
 * sitting in a given status of a given machine.
 *
 * Lookups must be synchronous (the engine and availableActions call them on
 * every check), so rows are cached in memory and refreshed on a short
 * interval — plus invalidated immediately when the admin saves a change.
 * When no row exists, the caller falls back to the machine's hardcoded
 * default, so a missing table never locks anyone out.
 */
export class OwnershipService {
  private cache = new Map<string, string[]>();
  private loadedOnce = false;

  constructor(
    private readonly prisma: PrismaClient,
    refreshMs = 60_000,
  ) {
    void this.reload();
    const handle = setInterval(() => void this.reload(), refreshMs);
    handle.unref();
  }

  /** Sync lookup for the engine — undefined = use the machine's default. */
  rolesFor(processKey: string, status: string): string[] | undefined {
    return this.cache.get(`${processKey}:${status}`);
  }

  isLoaded(): boolean {
    return this.loadedOnce;
  }

  async list() {
    return this.prisma.statusOwnership.findMany({
      orderBy: [{ processKey: 'asc' }, { status: 'asc' }],
    });
  }

  async update(id: string, roles: string[]) {
    const row = await this.prisma.statusOwnership.update({
      where: { id },
      data: { roles },
    });
    await this.reload(); // apply immediately, not on the next refresh
    return row;
  }

  async reload(): Promise<void> {
    try {
      const rows = await this.prisma.statusOwnership.findMany();
      const next = new Map<string, string[]>();
      for (const row of rows) {
        next.set(`${row.processKey}:${row.status}`, row.roles as string[]);
      }
      this.cache = next;
      this.loadedOnce = true;
    } catch (err) {
      logger.error({ err }, 'ownership cache reload failed');
    }
  }
}
