<script setup lang="ts">
/**
 * The active company's organisation: the branch / department tree with a
 * manager per unit, and the job-title master. Everything here belongs to
 * the selected company — the server refuses anything else.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { useListsStore } from '../stores/lists';
import { useConfirm } from '../composables/useConfirm';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

interface Unit {
  id: string;
  parentId: string | null;
  type: string;
  code: string;
  nameAr: string;
  nameEn: string;
  path: string;
  depth: number;
  active: boolean;
  managerId: string | null;
  manager: { id: string; name: string; email: string } | null;
  _count: { children: number; employees: number };
}
interface Title {
  id: string;
  code: string;
  titleAr: string;
  titleEn: string;
  active: boolean;
  _count: { employees: number };
}
interface StaffUser { id: string; name: string; email: string; active: boolean }

const { t, locale } = useI18n();
const auth = useAuthStore();
const lists = useListsStore();
const confirm = useConfirm();
const ar = computed(() => locale.value.startsWith('ar'));
const name = (u: { nameAr: string; nameEn: string }) => (ar.value ? u.nameAr : u.nameEn);
const title = (p: Title) => (ar.value ? p.titleAr : p.titleEn);

const tab = ref<'structure' | 'titles'>('structure');
const units = ref<Unit[]>([]);
const titles = ref<Title[]>([]);
const staff = ref<StaffUser[]>([]);
const loading = ref(true);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });
const fail = (e: unknown) => notify(e instanceof ApiError ? e.message : t('common.error'), 'error');

async function load() {
  loading.value = true;
  try {
    const [u, p] = await Promise.all([api.get<Unit[]>('/api/org/units'), api.get<Title[]>('/api/org/positions')]);
    units.value = u;
    titles.value = p;
    if (auth.can('users.manage')) {
      staff.value = (await api.get<{ items: StaffUser[] }>('/api/users?page=1&limit=100')).items.filter((s) => s.active);
    }
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- tree
/** Flat rows ordered by path → nested; collapsed ids hide their subtree. */
const collapsed = ref<Set<string>>(new Set());
const visibleUnits = computed(() => {
  const hidden: string[] = [];
  return units.value.filter((u) => {
    if (hidden.some((p) => u.path.startsWith(p))) return false;
    if (collapsed.value.has(u.id)) hidden.push(u.path);
    return true;
  });
});
function toggle(u: Unit) {
  const next = new Set(collapsed.value);
  if (next.has(u.id)) next.delete(u.id);
  else next.add(u.id);
  collapsed.value = next;
}
const typeLabel = (code: string) => lists.label('ORG_UNIT_TYPE', code) ?? code;
const typeItems = computed(() => lists.items('ORG_UNIT_TYPE'));
const staffItems = computed(() => [
  { title: t('org.noManager'), value: null },
  ...staff.value.map((s) => ({ title: s.name, value: s.id, props: { subtitle: s.email } })),
]);
const parentItems = (self?: Unit) =>
  [
    { title: t('org.topLevel'), value: null },
    ...units.value
      .filter((u) => u.active && (!self || (u.id !== self.id && !u.path.startsWith(self.path))))
      .map((u) => ({ title: `${'— '.repeat(u.depth)}${name(u)}`, value: u.id, props: { subtitle: u.code } })),
  ];

const unitDialog = ref<{ show: boolean; id: string | null; parentId: string | null; type: string; code: string; nameAr: string; nameEn: string; managerId: string | null; active: boolean }>({
  show: false, id: null, parentId: null, type: 'DEPARTMENT', code: '', nameAr: '', nameEn: '', managerId: null, active: true,
});
const unitOk = computed(() => /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(unitDialog.value.code.trim()) && unitDialog.value.nameAr.trim() && unitDialog.value.nameEn.trim());

function openUnit(parent?: Unit, existing?: Unit) {
  unitDialog.value = existing
    ? { show: true, id: existing.id, parentId: existing.parentId, type: existing.type, code: existing.code, nameAr: existing.nameAr, nameEn: existing.nameEn, managerId: existing.managerId, active: existing.active }
    : { show: true, id: null, parentId: parent?.id ?? null, type: parent ? 'DEPARTMENT' : 'BRANCH', code: '', nameAr: '', nameEn: '', managerId: null, active: true };
}

async function saveUnit() {
  busy.value = 'unit';
  try {
    const d = unitDialog.value;
    const body = { parentId: d.parentId, type: d.type, code: d.code.trim(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), managerId: d.managerId, active: d.active };
    if (d.id) await api.put(`/api/org/units/${d.id}`, body);
    else await api.post('/api/org/units', body);
    unitDialog.value.show = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}

async function removeUnit(u: Unit) {
  if (!(await confirm({ title: t('org.deleteUnit'), message: t('org.deleteUnitConfirm', { name: name(u) }), color: 'error', confirmText: t('common.delete'), icon: 'trash-2' }))) return;
  busy.value = u.id;
  try {
    await api.delete(`/api/org/units/${u.id}`);
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}

// -------------------------------------------------------------- titles
const titleDialog = ref<{ show: boolean; id: string | null; code: string; titleAr: string; titleEn: string; active: boolean }>({
  show: false, id: null, code: '', titleAr: '', titleEn: '', active: true,
});
const titleOk = computed(() => /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(titleDialog.value.code.trim()) && titleDialog.value.titleAr.trim() && titleDialog.value.titleEn.trim());
function openTitle(existing?: Title) {
  titleDialog.value = existing
    ? { show: true, id: existing.id, code: existing.code, titleAr: existing.titleAr, titleEn: existing.titleEn, active: existing.active }
    : { show: true, id: null, code: '', titleAr: '', titleEn: '', active: true };
}
async function saveTitle() {
  busy.value = 'title';
  try {
    const d = titleDialog.value;
    const body = { code: d.code.trim(), titleAr: d.titleAr.trim(), titleEn: d.titleEn.trim(), active: d.active };
    if (d.id) await api.put(`/api/org/positions/${d.id}`, body);
    else await api.post('/api/org/positions', body);
    titleDialog.value.show = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}
async function removeTitle(p: Title) {
  if (!(await confirm({ title: t('org.deleteTitle'), message: t('org.deleteTitleConfirm', { name: title(p) }), color: 'error', confirmText: t('common.delete'), icon: 'trash-2' }))) return;
  busy.value = p.id;
  try {
    await api.delete(`/api/org/positions/${p.id}`);
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}

const titleHeaders = computed(() => [
  { title: t('org.code'), key: 'code', width: 150 },
  { title: t('org.title'), key: 'title' },
  { title: t('org.employees'), key: 'employees', align: 'end' as const, width: 120 },
  { title: t('fields.status'), key: 'active', width: 110 },
  { title: '', key: 'actions', sortable: false, width: 110, align: 'end' as const },
]);

onMounted(async () => {
  await lists.load();
  await load();
});
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('org.title_')" :subtitle="$t('org.subtitle', { company: auth.user?.activeCompany ? name(auth.user.activeCompany) : '' })">
      <v-btn v-if="tab === 'structure' && auth.can('org.manage')" color="primary" prepend-icon="plus" @click="openUnit()">{{ $t('org.newBranch') }}</v-btn>
      <v-btn v-else-if="auth.can('org.manage')" color="primary" prepend-icon="plus" @click="openTitle()">{{ $t('org.newTitle') }}</v-btn>
    </PageHeader>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="structure">{{ $t('org.structure') }}</v-tab>
      <v-tab value="titles">{{ $t('org.titles') }}</v-tab>
    </v-tabs>

    <!-- ───────── structure ───────── -->
    <v-card v-if="tab === 'structure'">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-else-if="units.length === 0" icon="fluent:people-team" :title="$t('org.empty')" :hint="$t('org.emptyHint')" />
      <v-table v-else density="comfortable" class="org-table">
        <thead>
          <tr>
            <th>{{ $t('org.unit') }}</th>
            <th style="width: 130px">{{ $t('org.type') }}</th>
            <th style="width: 220px">{{ $t('org.manager') }}</th>
            <th style="width: 100px" class="text-end">{{ $t('org.employees') }}</th>
            <th style="width: 150px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in visibleUnits" :key="u.id" :class="{ 'org-row--inactive': !u.active }">
            <td>
              <div class="org-cell" :style="{ paddingInlineStart: `${u.depth * 22}px` }">
                <v-btn
                  v-if="u._count.children"
                  :icon="collapsed.has(u.id) ? 'chevron-right' : 'chevron-down'"
                  variant="text"
                  size="x-small"
                  class="flip-rtl"
                  @click="toggle(u)"
                />
                <span v-else class="org-cell__spacer" />
                <div class="min-w-0">
                  <div class="text-body-2 font-weight-semibold text-truncate">{{ name(u) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ u.code }} · {{ ar ? u.nameEn : u.nameAr }}</div>
                </div>
              </div>
            </td>
            <td><v-chip size="x-small" variant="tonal">{{ typeLabel(u.type) }}</v-chip></td>
            <td>
              <template v-if="u.manager">
                <div class="text-body-2 text-truncate">{{ u.manager.name }}</div>
                <div class="text-caption text-medium-emphasis text-truncate" dir="ltr">{{ u.manager.email }}</div>
              </template>
              <span v-else class="text-caption text-disabled">{{ $t('org.noManager') }}</span>
            </td>
            <td class="text-end tnum">{{ u._count.employees }}</td>
            <td class="text-end">
              <template v-if="auth.can('org.manage')">
                <v-btn icon="plus" variant="text" size="small" :aria-label="$t('org.addChild')" @click="openUnit(u)" />
                <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openUnit(undefined, u)" />
                <v-btn icon="trash-2" variant="text" size="small" :loading="busy === u.id" :aria-label="$t('common.delete')" @click="removeUnit(u)" />
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text class="text-caption text-medium-emphasis">{{ $t('org.hint') }}</v-card-text>
    </v-card>

    <!-- ───────── titles ───────── -->
    <v-card v-else>
      <v-data-table :headers="titleHeaders" :items="titles" :loading="loading" item-value="id">
        <template #item.code="{ item }"><span class="tnum font-weight-medium">{{ item.code }}</span></template>
        <template #item.title="{ item }">
          <div class="text-body-2 font-weight-semibold">{{ title(item) }}</div>
          <div class="text-caption text-medium-emphasis">{{ ar ? item.titleEn : item.titleAr }}</div>
        </template>
        <template #item.employees="{ item }"><span class="tnum">{{ item._count.employees }}</span></template>
        <template #item.active="{ item }">
          <v-chip size="small" :color="item.active ? 'success' : undefined" class="status-dot">{{ item.active ? $t('company.active') : $t('company.inactive') }}</v-chip>
        </template>
        <template #item.actions="{ item }">
          <template v-if="auth.can('org.manage')">
            <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openTitle(item)" />
            <v-btn icon="trash-2" variant="text" size="small" :loading="busy === item.id" :aria-label="$t('common.delete')" @click="removeTitle(item)" />
          </template>
        </template>
        <template #no-data>
          <EmptyState icon="fluent:briefcase" :title="$t('org.noTitles')" :hint="$t('org.noTitlesHint')" />
        </template>
      </v-data-table>
    </v-card>

    <!-- unit dialog -->
    <v-dialog v-model="unitDialog.show" max-width="560">
      <v-card :title="unitDialog.id ? $t('org.editUnit') : $t('org.newUnit')" class="pa-2">
        <v-card-text>
          <v-select v-model="unitDialog.parentId" :items="parentItems(units.find((x) => x.id === unitDialog.id))" :label="$t('org.parent')" class="mb-1" />
          <v-select v-model="unitDialog.type" :items="typeItems" item-title="title" item-value="value" :label="$t('org.type')" class="mb-1" />
          <v-text-field v-model="unitDialog.code" :label="$t('org.code')" :hint="$t('org.codeHint')" persistent-hint dir="ltr" class="mb-2" />
          <v-text-field v-model="unitDialog.nameAr" :label="$t('org.nameAr')" />
          <v-text-field v-model="unitDialog.nameEn" :label="$t('org.nameEn')" dir="ltr" />
          <v-select v-if="auth.can('users.manage')" v-model="unitDialog.managerId" :items="staffItems" :label="$t('org.manager')" :hint="$t('org.managerHint')" persistent-hint class="mb-2" />
          <v-switch v-if="unitDialog.id" v-model="unitDialog.active" :label="$t('company.active')" color="success" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="unitDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy === 'unit'" :disabled="!unitOk" @click="saveUnit">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- title dialog -->
    <v-dialog v-model="titleDialog.show" max-width="520">
      <v-card :title="titleDialog.id ? $t('org.editTitle') : $t('org.newTitle')" class="pa-2">
        <v-card-text>
          <v-text-field v-model="titleDialog.code" :label="$t('org.code')" :hint="$t('org.codeHint')" persistent-hint dir="ltr" class="mb-2" />
          <v-text-field v-model="titleDialog.titleAr" :label="$t('org.titleAr')" />
          <v-text-field v-model="titleDialog.titleEn" :label="$t('org.titleEn')" dir="ltr" />
          <v-switch v-if="titleDialog.id" v-model="titleDialog.active" :label="$t('company.active')" color="success" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="titleDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy === 'title'" :disabled="!titleOk" @click="saveTitle">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.org-cell { display: flex; align-items: center; gap: 4px; min-width: 0; }
.org-cell__spacer { display: inline-block; width: 28px; flex: none; }
.org-row--inactive { opacity: 0.55; }
.org-table td:last-child { white-space: nowrap; }
</style>
