<script setup lang="ts">
/**
 * Global company administration (super admin): create companies, rename
 * them, switch them on/off. Counts only — a company's people live in its
 * workspace, behind the selector.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../api/client';
import { useAuthStore } from '../stores/auth';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

interface CompanyRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
  createdAt: string;
  _count: { employees: number; orgUnits: number; assignments: number };
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const rows = ref<CompanyRow[]>([]);
const loading = ref(true);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });

const name = (c: CompanyRow) => (locale.value.startsWith('ar') ? c.nameAr : c.nameEn);

const headers = computed(() => [
  { title: t('company.code'), key: 'code', width: 140 },
  { title: t('company.name'), key: 'name' },
  { title: t('company.employees'), key: 'employees', align: 'end' as const, width: 120 },
  { title: t('company.units'), key: 'units', align: 'end' as const, width: 120 },
  { title: t('fields.status'), key: 'active', width: 120 },
  { title: '', key: 'actions', sortable: false, width: 140, align: 'end' as const },
]);

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get<CompanyRow[]>('/api/companies');
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    loading.value = false;
  }
}

const dialog = ref<{ show: boolean; id: string | null; code: string; nameAr: string; nameEn: string; active: boolean }>({
  show: false, id: null, code: '', nameAr: '', nameEn: '', active: true,
});
const codeOk = computed(() => /^[A-Za-z][A-Za-z0-9_]{1,30}$/.test(dialog.value.code.trim()));
const formOk = computed(() => (dialog.value.id || codeOk.value) && dialog.value.nameAr.trim() && dialog.value.nameEn.trim());

function openCreate() {
  dialog.value = { show: true, id: null, code: '', nameAr: '', nameEn: '', active: true };
}
function openEdit(c: CompanyRow) {
  dialog.value = { show: true, id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, active: c.active };
}

async function save() {
  busy.value = 'save';
  try {
    const d = dialog.value;
    if (d.id) {
      await api.put(`/api/companies/${d.id}`, { nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), active: d.active });
    } else {
      await api.post('/api/companies', { code: d.code.trim().toUpperCase(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim() });
    }
    dialog.value.show = false;
    notify(t('common.saved'));
    await load();
    // A new company should appear in the switcher without a re-login.
    await auth.refreshSession();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function toggleActive(c: CompanyRow) {
  busy.value = c.id;
  try {
    await api.put(`/api/companies/${c.id}`, { active: !c.active });
    notify(t('common.saved'));
    await load();
    await auth.refreshSession();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <v-container class="py-8" style="max-width: 1000px">
    <PageHeader :title="$t('company.adminTitle')" :subtitle="$t('company.adminSubtitle')">
      <v-btn color="primary" prepend-icon="plus" @click="openCreate">{{ $t('company.new') }}</v-btn>
    </PageHeader>

    <v-card>
      <v-data-table :headers="headers" :items="rows" :loading="loading" item-value="id">
        <template #item.code="{ item }"><span class="tnum font-weight-medium">{{ item.code }}</span></template>
        <template #item.name="{ item }">
          <div class="text-body-2 font-weight-semibold">{{ name(item) }}</div>
          <div class="text-caption text-medium-emphasis">{{ locale.startsWith('ar') ? item.nameEn : item.nameAr }}</div>
        </template>
        <template #item.employees="{ item }"><span class="tnum">{{ item._count.employees }}</span></template>
        <template #item.units="{ item }"><span class="tnum">{{ item._count.orgUnits }}</span></template>
        <template #item.active="{ item }">
          <v-chip size="small" :color="item.active ? 'success' : undefined" class="status-dot">
            {{ item.active ? $t('company.active') : $t('company.inactive') }}
          </v-chip>
        </template>
        <template #item.actions="{ item }">
          <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openEdit(item)" />
          <v-btn
            :icon="item.active ? 'circle-pause' : 'circle-play'"
            variant="text"
            size="small"
            :loading="busy === item.id"
            :disabled="item.id === auth.user?.activeCompany?.id && item.active"
            :aria-label="item.active ? $t('company.deactivate') : $t('company.activate')"
            @click="toggleActive(item)"
          />
        </template>
        <template #no-data>
          <EmptyState icon="fluent:building-people" :title="$t('company.none')" :hint="$t('company.noneHint')" />
        </template>
      </v-data-table>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="520">
      <v-card :title="dialog.id ? $t('company.edit') : $t('company.new')" class="pa-2">
        <v-card-text>
          <v-text-field
            v-model="dialog.code"
            :label="$t('company.code')"
            :hint="$t('company.codeHint')"
            persistent-hint
            :disabled="!!dialog.id"
            :error="!dialog.id && dialog.code.length > 0 && !codeOk"
            dir="ltr"
            class="mb-2"
          />
          <v-text-field v-model="dialog.nameAr" :label="$t('company.nameAr')" />
          <v-text-field v-model="dialog.nameEn" :label="$t('company.nameEn')" dir="ltr" />
          <v-switch v-if="dialog.id" v-model="dialog.active" :label="$t('company.active')" color="success" hide-details />
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
