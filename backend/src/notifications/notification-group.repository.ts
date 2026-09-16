import type { Db } from '../common/prisma.js';

/** One person on a team: an e-mail address, optionally tied to a staff account. */
export interface GroupMember {
  id: string;
  name: string;
  email: string;
  userId: string | null;
}

export interface GroupAssignment {
  processKey: string;
  status: string;
}

export interface GroupInput {
  key: string;
  nameAr: string;
  nameEn: string;
  description?: string | null | undefined;
  sortOrder?: number | undefined;
}

export interface MemberInput {
  name: string;
  email: string;
  userId?: string | null | undefined;
}

const withRelations = {
  members: { orderBy: { name: 'asc' as const } },
  assignments: { orderBy: [{ processKey: 'asc' as const }, { status: 'asc' as const }] },
};

/**
 * Responsible teams and who is on them. Members are stored as e-mail
 * addresses so a team can exist before its people have accounts; `userId`
 * is filled in by an admin later and adds the in-app bell for that person.
 */
export class NotificationGroupRepository {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.notificationGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: withRelations,
    });
  }

  findById(id: string) {
    return this.db.notificationGroup.findUnique({ where: { id }, include: withRelations });
  }

  findByKey(key: string) {
    return this.db.notificationGroup.findUnique({ where: { key }, include: withRelations });
  }

  create(input: GroupInput) {
    return this.db.notificationGroup.create({
      data: {
        key: input.key,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
      include: withRelations,
    });
  }

  update(id: string, changes: Partial<Omit<GroupInput, 'key'>>) {
    return this.db.notificationGroup.update({
      where: { id },
      data: {
        ...(changes.nameAr !== undefined ? { nameAr: changes.nameAr } : {}),
        ...(changes.nameEn !== undefined ? { nameEn: changes.nameEn } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.sortOrder !== undefined ? { sortOrder: changes.sortOrder } : {}),
      },
      include: withRelations,
    });
  }

  /** Members and assignments go with it (ON DELETE CASCADE). */
  remove(id: string) {
    return this.db.notificationGroup.delete({ where: { id } });
  }

  /** The whole member list at once — the UI edits the list, not one row. */
  async replaceMembers(id: string, members: MemberInput[]) {
    const seen = new Set<string>();
    const clean = members
      .map((m) => ({ ...m, email: m.email.trim().toLowerCase(), name: m.name.trim() }))
      .filter((m) => m.email && !seen.has(m.email) && seen.add(m.email));
    await this.db.notificationGroupMember.deleteMany({ where: { groupId: id } });
    if (clean.length) {
      await this.db.notificationGroupMember.createMany({
        data: clean.map((m) => ({ groupId: id, name: m.name, email: m.email, userId: m.userId ?? null })),
      });
    }
    return this.findById(id);
  }

  /** Which (process, status) pairs this team follows up. */
  async replaceAssignments(id: string, assignments: GroupAssignment[]) {
    const seen = new Set<string>();
    const clean = assignments.filter((a) => {
      const k = `${a.processKey}:${a.status}`;
      return !seen.has(k) && seen.add(k);
    });
    await this.db.notificationGroupAssignment.deleteMany({ where: { groupId: id } });
    if (clean.length) {
      await this.db.notificationGroupAssignment.createMany({
        data: clean.map((a) => ({ groupId: id, processKey: a.processKey, status: a.status })),
      });
    }
    return this.findById(id);
  }

  /**
   * Everyone responsible for a status, across every team assigned to it —
   * one entry per e-mail address. Empty means "no team": callers fall back
   * to the role-wide broadcast.
   */
  async membersFor(processKey: string, status: string): Promise<GroupMember[]> {
    const rows = await this.db.notificationGroupAssignment.findMany({
      where: { processKey, status },
      include: { group: { include: { members: true } } },
    });
    return dedupe(rows.flatMap((r) => r.group.members));
  }

  async membersOf(groupId: string): Promise<GroupMember[]> {
    const rows = await this.db.notificationGroupMember.findMany({ where: { groupId } });
    return dedupe(rows);
  }
}

function dedupe(members: GroupMember[]): GroupMember[] {
  const seen = new Set<string>();
  return members.filter((m) => {
    const key = m.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
