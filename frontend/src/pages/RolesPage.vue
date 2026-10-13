<script setup lang="ts">
/**
 * Roles and their permission bundles (global administration). System roles
 * can be re-bundled, never deleted; custom roles come and go. Where a role
 * applies (which company / unit) is set per user on the Staff page.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useConfirm } from '../composables/useConfirm';
import PageHeader from '../components/PageHeader.vue';

interface Role {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: 'GLOBAL' | 'COMPANY' | 'UNIT';
  system: boolean;
  active: boolean;
  permissions: Array<{ permission: string }>;
  _count: { assignments: number };
}
interface PermissionMeta { code: string; nameAr: string; nameEn: string }

const { t, locale } = useI18n();
const confirm = useConfirm();
const ar = computed(() => locale.value.startsWith('ar'));
const name = (r: { nameAr: string; nameEn: string }) => (ar.value ? r.nameAr : r.nameEn);

const roles = ref<Role[]>([]);
const catalogue = ref<PermissionMeta[]>([]);
const loading = ref(true);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });
const fail = (e: unknown) => notify(e instanceof ApiError ? e.message : t('common.error'), 'error');

/** Permissions grouped by their area prefix, so the editor reads as sections. */
const groups = computed(() => {
  const by = new Map<string, PermissionMeta[]>();
  for (const p of catalogue.value) {
    const area = p.code.split('.')[0] ?? p.code;
    by.set(area, [...(by.get(area) ?? []), p]);
  }
  return [...by].map(([area, items]) => ({ area, items }));
});

async function load() {
  loading.value = true;
  try {
    const [r, c] = await Promise.all([api.get<Role[]>('/api/roles'), api.get<PermissionMeta[]>('/api/roles/permissions')]);
    roles.value = r;
    catalogue.value = c;
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}

const dialog = ref<{ show: boolean; id: string | null; system: boolean; code: string; nameAr: string; nameEn: string; level: Role['level']; permissions: string[]; active: boolean }>({
  show: false, id: null, system: false, code: '', nameAr: '', nameEn: '', level: 'COMPANY', permissions: [], active: true,
});
const formOk = computed(() => (dialog.value.id || /^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(dialog.value.code.trim())) && dialog.value.nameAr.trim() && dialog.value.nameEn.trim());

function openCreate() {
  dialog.value = { show: true, id: null, system: false, code: '', nameAr: '', nameEn: '', level: 'COMPANY', permissions: [], active: true };
}
function openEdit(r: Role) {
  dialog.value = { show: true, id: r.id, system: r.system, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, level: r.level, permissions: r.permissions.map((p) => p.permission), active: r.active };
}
function has(code: string) {
  return dialog.value.permissions.includes(code);
}
function togglePerm(code: string) {
  dialog.value.permissions = has(code) ? dialog.value.permissions.filter((p) => p !== code) : [...dialog.value.permissions, code];
}

async function save() {
  busy.value = 'save';
  try {
    const d = dialog.value;
    const body = { nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), permissions: d.permissions, ...(d.system ? {} : { level: d.level, active: d.active }) };
    if (d.id) await api.put(`/api/roles/${d.id}`, body);
    else await api.post('/api/roles', { code: d.code.trim().toUpperCase(), level: d.level, ...body });
    dialog.value.show = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}

async function remove(r: Role) {
  if (!(await confirm({ title: t('roles.delete'), message: t('roles.deleteConfirm', { name: name(r) }), color: 'error', confirmText: t('common.delete'), icon: 'trash-2' }))) return;
  busy.value = r.id;
  try {
    await api.delete(`/api/roles/${r.id}`);
    notify(t('common.saved'));
    await load();
  } catch (e) {
    fail(e);
  } finally {
    busy.value = '';
  }
}

const headers = computed(() => [
  { title: t('roles.role'), key: 'name' },
  { title: t('roles.level'), key: 'level', width: 140 },
  { title: t('roles.permissions'), key: 'permissions', align: 'end' as const, width: 120 },
  { title: t('roles.holders'), key: 'holders', align: 'end' as const, width: 110 },
  { title: '', key: 'actions', sortable: false, width: 110, align: 'end' as const },
]);

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1000px">
    <PageHeader :title="$t('roles.title')" :subtitle="$t('roles.subtitle')">
      <v-btn color="primary" prepend-icon="plus" @click="openCreate">{{ $t('roles.new') }}</v-btn>
    </PageHeader>

    <v-card>
      <v-data-table :headers="headers" :items="roles" :loading="loading" item-value="id">
        <template #item.name="{ item }">
          <div class="d-flex align-center ga-2">
            <div>
              <div class="text-body-2 font-weight-semibold">{{ name(item) }}</div>
              <div class="text-caption text-medium-emphasis">{{ item.code }}</div>
            </div>
            <v-chip v-if="item.system" size="x-small" variant="tonal">{{ $t('roles.system') }}</v-chip>
            <v-chip v-if="!item.active" size="x-small" variant="tonal" color="warning">{{ $t('company.inactive') }}</v-chip>
          </div>
        </template>
        <template #item.level="{ item }">{{ $t(`roles.levels.${item.level}`) }}</template>
        <template #item.permissions="{ item }"><span class="tnum">{{ item.permissions.length }}</span></template>
        <template #item.holders="{ item }"><span class="tnum">{{ item._count.assignments }}</span></template>
        <template #item.actions="{ item }">
          <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openEdit(item)" />
          <v-btn v-if="!item.system" icon="trash-2" variant="text" size="small" :loading="busy === item.id" :aria-label="$t('common.delete')" @click="remove(item)" />
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="720" scrollable>
      <v-card :title="dialog.id ? $t('roles.edit') : $t('roles.new')" class="pa-2">
        <v-card-text style="max-height: 70vh">
          <v-row dense>
            <v-col cols="12" sm="4">
              <v-text-field v-model="dialog.code" :label="$t('roles.code')" :disabled="!!dialog.id" dir="ltr" />
            </v-col>
            <v-col cols="12" sm="4"><v-text-field v-model="dialog.nameAr" :label="$t('org.nameAr')" /></v-col>
            <v-col cols="12" sm="4"><v-text-field v-model="dialog.nameEn" :label="$t('org.nameEn')" dir="ltr" /></v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="dialog.level"
                :items="(['GLOBAL', 'COMPANY', 'UNIT'] as const).map((l) => ({ title: $t(`roles.levels.${l}`), value: l }))"
                :label="$t('roles.level')"
                :hint="$t('roles.levelHint')"
                persistent-hint
                :disabled="dialog.system"
              />
            </v-col>
            <v-col v-if="dialog.id && !dialog.system" cols="12" sm="6" class="d-flex align-center">
              <v-switch v-model="dialog.active" :label="$t('company.active')" color="success" hide-details />
            </v-col>
          </v-row>

          <div class="text-caption text-medium-emphasis mt-4 mb-1">{{ $t('roles.permissions') }} · {{ dialog.permissions.length }}</div>
          <div v-for="g in groups" :key="g.area" class="perm-group">
            <div class="perm-group__head">{{ $t(`roles.areas.${g.area}`, g.area) }}</div>
            <div class="perm-group__items">
              <v-checkbox
                v-for="p in g.items"
                :key="p.code"
                :model-value="has(p.code)"
                :label="ar ? p.nameAr : p.nameEn"
                density="compact"
                hide-details
                color="primary"
                @update:model-value="togglePerm(p.code)"
              />
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy === 'save'" :disabled="!formOk" @click="save">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.perm-group { padding: 10px 0; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.perm-group__head { font-size: 12px; font-weight: 600; margin-bottom: 2px; color: rgb(var(--v-theme-primary)); }
.perm-group__items { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
</style>
