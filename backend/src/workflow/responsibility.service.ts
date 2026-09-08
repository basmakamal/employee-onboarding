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

/**
 * Primary follow-up responsibility per process — the NAMES that receive the
 * reminders (e.g. GOSI → Ayman + Aljawhara). This is about notifications
 * and accountability only: it never restricts who may act. Permission to
 * execute stays with the role groups (status ownership), so any authorised
 * teammate can finish a step when the primary owner is away.
 *
 * Stored as one JSON setting; cached briefly because the SLA tick reads it
 * for every reminder.
 */
export class ResponsibilityService {
  private cache: { map: Map_; at: number } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  private async load(): Promise<Map_> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.map;
    let map: Map_ = {};
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
      if (row) map = JSON.parse(row.value) as Map_;
    } catch (err) {
      logger.error({ err }, 'responsibility setting unreadable — treating as empty');
    }
    this.cache = { map, at: Date.now() };
    return map;
  }

  /** User ids primarily responsible for a process; empty = fall back to the role group. */
  async get(processKey: string): Promise<string[]> {
    const map = await this.load();
    return map[processKey as ResponsibilityKey] ?? [];
  }

  async all(): Promise<Record<ResponsibilityKey, string[]>> {
    const map = await this.load();
    return Object.fromEntries(
      RESPONSIBILITY_KEYS.map((k) => [k, map[k] ?? []]),
    ) as Record<ResponsibilityKey, string[]>;
  }

  async set(processKey: ResponsibilityKey, userIds: string[]): Promise<void> {
    const map = { ...(await this.load()), [processKey]: [...new Set(userIds)] };
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(map) },
      update: { value: JSON.stringify(map) },
    });
    this.cache = null;
  }
}
