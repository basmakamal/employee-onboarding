<script setup lang="ts">
/**
 * Three admin controls that are easy to confuse, kept side by side on purpose:
 *   - Responsible teams: named PEOPLE (e-mail addresses, optionally linked to
 *     an account) who follow up given statuses. Where a status has a team,
 *     the team receives the notice INSTEAD of the whole role group.
 *   - Primary owners: PEOPLE (accounts) who receive reminders per process in
 *     addition to the role group — the fallback when a status has no team.
 *   - Status ownership: which role GROUPS may act on each status (permission).
 * Only the last one restricts who may act.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import { useConfirm } from '../composables/useConfirm';

interface OwnershipRow {
  id: string;
  processKey: string;
  status: string;
  roles: string[];
}

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

interface TeamMember {
  id?: string;
  name: string;
  email: string;
  userId: string | null;
}

interface TeamAssignment {
  processKey: string;
  status: string;
}

interface Team {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  description: string | null;
  sortOrder: number;
  members: TeamMember[];
  assignments: TeamAssignment[];
}

/** Every (process, status) a team can be made responsible for — mirrors the server catalogue. */
const MACHINE_STATUSES: Record<string, string[]> = {
  EMPLOYEE: ['CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION', 'AWAITING_CONTRACT_APPROVAL', 'EXPIRED', 'ACTIVE', 'INACTIVE', 'WITHDRAWN'],
  GOSI: ['PENDING', 'DONE', 'ON_HOLD', 'CANCELLED'],
  MEDICAL_INSURANCE: ['PENDING', 'DONE', 'ON_HOLD', 'CANCELLED'],
  CRIMINAL_RECORD: ['TRAINING', 'REQUEST_SENT', 'PENDING', 'DONE'],
  ASSET_FORM: ['DRAFT', 'SENT', 'PENDING_EMPLOYEE_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  OFFBOARDING: ['REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED', 'CANCELLED'],
};

const ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'];
const RESPONSIBILITY_KEYS = [
  'EMPLOYEE',
  'GOSI',
  'MEDICAL_INSURANCE',
  'CRIMINAL_RECORD',
  'ASSET_FORM',
  'OFFBOARDING',
] as const;

const { t, locale } = useI18n();
const confirm = useConfirm();
const rows = ref<OwnershipRow[]>([]);
const teams = ref<Team[]>([]);
const responsibility = ref<Record<string, string[]>>({});
const staff = ref<StaffUser[]>([]);
const loaded = ref(false);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

const staffItems = computed(() =>
  staff.value
    .filter((u) => u.active)
    .map((u) => ({ title: u.name, value: u.id, props: { subtitle: `${u.email} · ${t(`roles.${u.role}`)}` } })),
);

async function load() {
  const [ownership, owners, users, groups] = await Promise.all([
    api.get<OwnershipRow[]>('/api/settings/ownership'),
    api.get<Record<string, string[]>>('/api/settings/responsibility'),
    api.get<{ items: StaffUser[] }>('/api/users?page=1&limit=100'),
    api.get<Team[]>('/api/settings/groups'),
  ]);
  rows.value = ownership;
  responsibility.value = owners;
  staff.value = users.items;
  teams.value = groups;
  loaded.value = true;
}

// ------------------------------------------------------------ teams
const teamName = (team: Team) => (locale.value.startsWith('ar') ? team.nameAr : team.nameEn);

function statusLabel(processKey: string, status: string): string {
  const key = processKey === 'OFFBOARDING' ? `offboardingStatus.${status}` : `status.${status}`;
  return t(key, t(`processStatus.${status}`, t(`assetStatus.${status}`, status)));
}

/** Every assignable status, grouped by process, as select items. */
const statusItems = computed(() =>
  Object.entries(MACHINE_STATUSES).flatMap(([processKey, statuses]) => [
    { type: 'subheader' as const, title: t(`entities.${processKey}`, processKey) },
    ...statuses.map((status) => ({
      title: statusLabel(processKey, status),
      value: `${processKey}:${status}`,
      props: { subtitle: t(`entities.${processKey}`, processKey) },
    })),
  ]),
);

const linkItems = computed(() => [
  { title: t('teams.noLinkedUser'), value: null },
  ...staff.value.filter((u) => u.active).map((u) => ({ title: u.name, value: u.id, props: { subtitle: u.email } })),
]);

// The card edits a local copy per team; Save sends the whole list.
const openTeams = ref<string[]>([]);
const draftMembers = ref<Record<string, TeamMember[]>>({});
const draftStatuses = ref<Record<string, string[]>>({});

function membersOf(team: Team): TeamMember[] {
  return (draftMembers.value[team.id] ??= team.members.map((m) => ({ ...m })));
}
function statusesOf(team: Team): string[] {
  return (draftStatuses.value[team.id] ??= team.assignments.map((a) => `${a.processKey}:${a.status}`));
}
function setStatuses(team: Team, value: string[]) {
  draftStatuses.value[team.id] = value;
}
function addMember(team: Team) {
  membersOf(team).push({ name: '', email: '', userId: null });
}
function removeMember(team: Team, index: number) {
  membersOf(team).splice(index, 1);
}
/** Picking an account fills the name and e-mail from it. */
function onLinkPicked(member: TeamMember, userId: string | null) {
  member.userId = userId;
  const user = staff.value.find((u) => u.id === userId);
  if (user) {
    if (!member.name) member.name = user.name;
    member.email = user.email;
  }
}

async function saveMembers(team: Team) {
  const members = membersOf(team).filter((m) => m.email.trim());
  if (members.some((m) => !m.name.trim())) {
    notify(t('teams.memberName') + ' — ' + t('common.error'), 'error');
    return;
  }
  busy.value = `team-members:${team.id}`;
  try {
    const updated = await api.put<Team>(`/api/settings/groups/${team.id}/members`, {
      members: members.map((m) => ({ name: m.name.trim(), email: m.email.trim(), userId: m.userId })),
    });
    replaceTeam(updated);
    delete draftMembers.value[team.id];
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function saveStatuses(team: Team) {
  busy.value = `team-statuses:${team.id}`;
  try {
    const assignments = statusesOf(team).map((v) => {
      const [processKey, status] = v.split(':') as [string, string];
      return { processKey, status };
    });
    const updated = await api.put<Team>(`/api/settings/groups/${team.id}/assignments`, { assignments });
    replaceTeam(updated);
    delete draftStatuses.value[team.id];
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

function replaceTeam(updated: Team) {
  teams.value = teams.value.map((x) => (x.id === updated.id ? updated : x));
}

const teamDialog = ref(false);
const newTeam = ref({ key: '', nameAr: '', nameEn: '', description: '' });

async function createTeam() {
  busy.value = 'team-create';
  try {
    const created = await api.post<Team>('/api/settings/groups', {
      key: newTeam.value.key.trim().toUpperCase(),
      nameAr: newTeam.value.nameAr.trim(),
      nameEn: newTeam.value.nameEn.trim(),
      description: newTeam.value.description.trim() || null,
      sortOrder: (teams.value.at(-1)?.sortOrder ?? 0) + 10,
    });
    teams.value = [...teams.value, created];
    openTeams.value = [...openTeams.value, created.id];
    teamDialog.value = false;
    newTeam.value = { key: '', nameAr: '', nameEn: '', description: '' };
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function deleteTeam(team: Team) {
  const ok = await confirm({
    title: t('teams.delete'),
    message: t('teams.deleteConfirm', { name: teamName(team) }),
    color: 'error',
    confirmText: t('teams.delete'),
    icon: 'trash-2',
  });
  if (!ok) return;
  busy.value = `team-delete:${team.id}`;
  try {
    await api.delete(`/api/settings/groups/${team.id}`);
    teams.value = teams.value.filter((x) => x.id !== team.id);
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function update(row: OwnershipRow, roles: string[]) {
  if (roles.length === 0) {
    notify(t('ownership.atLeastOne'), 'error');
    await load();
    return;
  }
  busy.value = row.id;
  try {
    await api.put(`/api/settings/ownership/${row.id}`, { roles });
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    await load();
  }
}

async function updateOwners(processKey: string, userIds: string[]) {
  busy.value = `owners:${processKey}`;
  try {
    responsibility.value = await api.put(`/api/settings/responsibility/${processKey}`, { userIds });
    notify(t('common.saved'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
    await load();
  } finally {
    busy.value = '';
  }
}

function processLabel(key: string): string {
  return key === 'EMPLOYEE' ? t('responsibility.EMPLOYEE') : t(`entities.${key}`, key);
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1000px">
    <PageHeader :title="$t('ownership.title')" :subtitle="$t('ownership.subtitle')" />

    <template v-if="loaded">
      <!-- Responsible TEAMS: named people per status (replace the role broadcast) -->
      <v-card class="mb-6">
        <v-card-item>
          <template #append>
            <v-btn color="primary" variant="flat" size="small" prepend-icon="plus" @click="teamDialog = true">
              {{ $t('teams.add') }}
            </v-btn>
          </template>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="users" class="me-2" color="primary" />
            {{ $t('teams.title') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('teams.subtitle') }}</v-card-subtitle>
        </v-card-item>

        <v-card-text v-if="teams.length === 0" class="text-medium-emphasis">{{ $t('teams.empty') }}</v-card-text>

        <v-expansion-panels v-else v-model="openTeams" multiple variant="accordion" class="team-panels">
          <v-expansion-panel v-for="team in teams" :key="team.id" :value="team.id">
            <v-expansion-panel-title>
              <div class="d-flex align-center flex-wrap ga-2 w-100">
                <span class="font-weight-semibold">{{ teamName(team) }}</span>
                <span class="text-caption text-medium-emphasis">{{ team.key }}</span>
                <v-spacer />
                <v-chip size="x-small" variant="tonal" prepend-icon="user">{{ $t('teams.membersCount', { n: team.members.length }) }}</v-chip>
                <v-chip size="x-small" variant="tonal" prepend-icon="list-checks" class="me-2">{{ $t('teams.statusesCount', { n: team.assignments.length }) }}</v-chip>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <p v-if="team.description" class="text-body-2 text-medium-emphasis mb-4">{{ team.description }}</p>

              <!-- members -->
              <div class="text-caption text-medium-emphasis mb-1">{{ $t('teams.members') }}</div>
              <div v-if="membersOf(team).length === 0" class="text-body-2 text-medium-emphasis mb-2">{{ $t('teams.noMembers') }}</div>
              <v-row v-for="(m, i) in membersOf(team)" :key="i" dense class="align-center">
                <v-col cols="12" sm="3">
                  <v-text-field v-model="m.name" :label="$t('teams.memberName')" density="compact" hide-details />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field v-model="m.email" :label="$t('teams.memberEmail')" density="compact" hide-details dir="ltr" type="email" />
                </v-col>
                <v-col cols="10" sm="4">
                  <v-select
                    :model-value="m.userId"
                    :items="linkItems"
                    :label="$t('teams.linkedUser')"
                    density="compact"
                    hide-details
                    @update:model-value="(v: string | null) => onLinkPicked(m, v)"
                  />
                </v-col>
                <v-col cols="2" sm="1" class="text-end">
                  <v-btn icon="x" variant="text" size="small" :aria-label="$t('common.delete')" @click="removeMember(team, i)" />
                </v-col>
              </v-row>
              <div class="d-flex flex-wrap ga-2 mt-2 mb-5">
                <v-btn size="small" variant="text" prepend-icon="user-plus" @click="addMember(team)">{{ $t('teams.addMember') }}</v-btn>
                <v-spacer />
                <v-btn size="small" color="primary" variant="tonal" :loading="busy === `team-members:${team.id}`" @click="saveMembers(team)">
                  {{ $t('teams.saveMembers') }}
                </v-btn>
              </div>

              <!-- statuses -->
              <div class="text-caption text-medium-emphasis mb-1">{{ $t('teams.statuses') }}</div>
              <v-select
                :model-value="statusesOf(team)"
                :items="statusItems"
                multiple
                chips
                closable-chips
                density="compact"
                hide-details
                :placeholder="$t('teams.noStatuses')"
                @update:model-value="(v: string[]) => setStatuses(team, v)"
              />
              <div class="d-flex flex-wrap ga-2 mt-2">
                <v-btn size="small" variant="text" color="error" prepend-icon="trash-2" :loading="busy === `team-delete:${team.id}`" @click="deleteTeam(team)">
                  {{ $t('teams.delete') }}
                </v-btn>
                <v-spacer />
                <v-btn size="small" color="primary" variant="tonal" :loading="busy === `team-statuses:${team.id}`" @click="saveStatuses(team)">
                  {{ $t('teams.saveStatuses') }}
                </v-btn>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-card-text class="text-caption text-medium-emphasis">{{ $t('teams.hint') }}</v-card-text>
      </v-card>

      <!-- Who is RESPONSIBLE (gets the reminders) -->
      <v-card class="mb-6">
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="fluent:person-starburst" class="me-2" />
            {{ $t('responsibility.title') }}
          </v-card-title>
          <v-card-subtitle class="text-wrap">{{ $t('responsibility.subtitle') }}</v-card-subtitle>
        </v-card-item>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('responsibility.process') }}</th>
              <th style="width: 460px">{{ $t('responsibility.owners') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in RESPONSIBILITY_KEYS" :key="key">
              <td class="font-weight-medium">{{ processLabel(key) }}</td>
              <td>
                <v-select
                  :model-value="responsibility[key] ?? []"
                  :items="staffItems"
                  :placeholder="$t('responsibility.none')"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  hide-details
                  variant="plain"
                  :disabled="busy === `owners:${key}`"
                  @update:model-value="(ids: string[]) => updateOwners(key, ids)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text class="text-caption text-medium-emphasis">
          {{ $t('responsibility.hint') }}
        </v-card-text>
      </v-card>

      <!-- Who MAY ACT (permission) -->
      <v-card>
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="fluent:shield-checkmark" class="me-2" />
            {{ $t('ownership.groups') }}
          </v-card-title>
        </v-card-item>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('ownership.machine') }}</th>
              <th>{{ $t('fields.status') }}</th>
              <th style="width: 340px">{{ $t('ownership.groups') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="font-weight-medium">{{ $t(`entities.${row.processKey}`, row.processKey) }}</td>
              <td>
                {{ $t(`status.${row.status}`, $t(`offboardingStatus.${row.status}`, $t(`processStatus.${row.status}`, $t(`assetStatus.${row.status}`, row.status)))) }}
              </td>
              <td>
                <v-select
                  :model-value="row.roles"
                  :items="ROLES.map((r) => ({ title: $t(`roles.${r}`), value: r }))"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  hide-details
                  variant="plain"
                  :disabled="busy === row.id"
                  @update:model-value="(roles: string[]) => update(row, roles)"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text class="text-caption text-medium-emphasis">
          {{ $t('ownership.hint') }}
        </v-card-text>
      </v-card>
    </template>

    <v-container v-else class="py-16 text-center">
      <v-progress-circular indeterminate color="primary" size="48" />
    </v-container>

    <!-- New team -->
    <v-dialog v-model="teamDialog" max-width="520">
      <v-card :title="$t('teams.add')" class="pa-2">
        <v-card-text>
          <v-text-field v-model="newTeam.key" :label="$t('teams.key')" :hint="$t('teams.keyHint')" persistent-hint dir="ltr" class="mb-2" />
          <v-text-field v-model="newTeam.nameAr" :label="$t('teams.nameAr')" />
          <v-text-field v-model="newTeam.nameEn" :label="$t('teams.nameEn')" dir="ltr" />
          <v-textarea v-model="newTeam.description" :label="$t('teams.description')" rows="2" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="teamDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'team-create'"
            :disabled="!/^[A-Z][A-Z0-9_]{1,60}$/.test(newTeam.key.trim().toUpperCase()) || !newTeam.nameAr.trim() || !newTeam.nameEn.trim()"
            @click="createTeam"
          >
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.team-panels :deep(.v-expansion-panel-title) {
  min-height: 52px;
}
</style>
