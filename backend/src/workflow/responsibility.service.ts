import type { PrismaClient } from '../generated/prisma/client.js';
import { logger } from '../common/logger.js';

const SETTING_KEY = 'responsibility';
const CACHE_MS = 30_000;

/** The processes a primary follow-up owner can be named for. */
export const RESPONSIBILITY_KEYS = [
  'EMPLOYEE',
  'GOSI',
  'MEDICAL_INSURANCE',
  'CRIMINAL_RECORD',
  'ASSET_FORM',
  'OFFBOARDING',
] as const;
export type ResponsibilityKey = (typeof RESPONSIBILITY_KEYS)[number];

type Map_ = Partial<Record<ResponsibilityKey, string[]>>;

/** Which company's owners: given directly, or found from the record a message is about. */
export interface ResponsibilityScope {
  companyId?: string | null;
  ref?: { entity: string; entityId: string };
}

/**
 * Primary follow-up responsibility per process — the NAMES that receive the
 * reminders in addition to the role group of the current status (e.g. GOSI →
 * Ayman + Aljawhara, plus everyone in the owning group). This is about
 * notifications and accountability only: it never restricts who may act.
 * Permission to execute stays with the role groups (status ownership), so any
 * authorised teammate can finish a step when the primary owner is away.
 *
 * Every company names its own owners. Stored as one JSON setting per
 * company; cached briefly because the SLA tick reads it for every reminder.
 */
export class ResponsibilityService {
  private cache = new Map<string, { map: Map_; at: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    /** Record → company, and "no company" → the main company. */
    private readonly companies?: {
      ofRef(ref: { entity: string; entityId: string }): Promise<string | null>;
      orMain(companyId: string | null | undefined): Promise<string | null>;
    },
  ) {}

  private async load(companyId: string | null): Promise<Map_> {
    if (!companyId) return {};
    const hit = this.cache.get(companyId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.map;
    let map: Map_ = {};
    try {
      const row = await this.prisma.setting.findUnique({ where: { companyId_key: { companyId, key: SETTING_KEY } } });
      if (row) map = JSON.parse(row.value) as Map_;
    } catch (err) {
      logger.error({ err, companyId }, 'responsibility setting unreadable — treating as empty');
    }
    this.cache.set(companyId, { map, at: Date.now() });
    return map;
  }

  private async companyOf(scope?: ResponsibilityScope): Promise<string | null> {
    const known = scope?.companyId !== undefined ? scope.companyId : scope?.ref ? await this.companies?.ofRef(scope.ref) : null;
    return this.companies ? this.companies.orMain(known ?? null) : (known ?? null);
  }

  /** User ids primarily responsible for a process in a company; empty = fall back to the role group. */
  async get(processKey: string, scope?: ResponsibilityScope): Promise<string[]> {
    const map = await this.load(await this.companyOf(scope));
    return map[processKey as ResponsibilityKey] ?? [];
  }

  async all(companyId: string): Promise<Record<ResponsibilityKey, string[]>> {
    const map = await this.load(companyId);
    return Object.fromEntries(
      RESPONSIBILITY_KEYS.map((k) => [k, map[k] ?? []]),
    ) as Record<ResponsibilityKey, string[]>;
  }

  async set(companyId: string, processKey: ResponsibilityKey, userIds: string[]): Promise<void> {
    const map = { ...(await this.load(companyId)), [processKey]: [...new Set(userIds)] };
    await this.prisma.setting.upsert({
      where: { companyId_key: { companyId, key: SETTING_KEY } },
      create: { companyId, key: SETTING_KEY, value: JSON.stringify(map) },
      update: { value: JSON.stringify(map) },
    });
    this.cache.delete(companyId);
  }
}
