<script setup lang="ts">
/**
 * Global company administration (super admin): create companies, rename
 * them, switch them on/off. Counts only — a company's people live in its
 * workspace, behind the selector.
 */
import { computed, onMounted, ref } from 'vue';
import { errorText } from '../validation/errors';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useForm } from '../composables/useForm';
import { rules } from '../validation/rules';

interface StaffUser { id: string; name: string; email: string; active: boolean }

interface CompanyRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
  managerId: string | null;
  manager: { id: string; name: string; email: string } | null;
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

const staff = ref<StaffUser[]>([]);
const staffItems = computed(() => [
  { title: t('org.noManager'), value: null },
  ...staff.value.filter((s) => s.active).map((s) => ({ title: s.name, value: s.id, props: { subtitle: s.email } })),
]);

const headers = computed(() => [
  { title: t('company.code'), key: 'code', width: 140 },
  { title: t('company.name'), key: 'name' },
  { title: t('company.manager'), key: 'manager', width: 200 },
  { title: t('company.employees'), key: 'employees', align: 'end' as const, width: 120 },
  { title: t('company.units'), key: 'units', align: 'end' as const, width: 120 },
  { title: t('fields.status'), key: 'active', width: 120 },
  { title: '', key: 'actions', sortable: false, width: 140, align: 'end' as const },
]);

async function load() {
  loading.value = true;
  try {
    const [companies, users] = await Promise.all([
      api.get<CompanyRow[]>('/api/companies'),
      auth.can('users.manage') ? api.get<{ items: StaffUser[] }>('/api/users?page=1&limit=100') : Promise.resolve({ items: [] as StaffUser[] }),
    ]);
    rows.value = companies;
    staff.value = users.items;
  } catch (e) {
    notify(errorText(e), 'error');
  } finally {
    loading.value = false;
  }
}

const dialog = ref<{ show: boolean; id: string | null; code: string; nameAr: string; nameEn: string; active: boolean; managerId: string | null }>({
  show: false, id: null, code: '', nameAr: '', nameEn: '', active: true, managerId: null,
});
const form = useForm();

function openCreate() {
  form.reset();
  dialog.value = { show: true, id: null, code: '', nameAr: '', nameEn: '', active: true, managerId: null };
}
function openEdit(c: CompanyRow) {
  form.reset();
  dialog.value = { show: true, id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, active: c.active, managerId: c.managerId };
}

function save() {
  return form.submit(async () => {
    const d = dialog.value;
    if (d.id) {
      await api.put(`/api/companies/${d.id}`, { nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), active: d.active, managerId: d.managerId });
    } else {
      await api.post('/api/companies', { code: d.code.trim().toUpperCase(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), managerId: d.managerId });
    }
    dialog.value.show = false;
    notify(t('common.saved'));
    await load();
    // A new company should appear in the switcher without a re-login.
    await auth.refreshSession();
  });
}

async function toggleActive(c: CompanyRow) {
  busy.value = c.id;
  try {
    await api.put(`/api/companies/${c.id}`, { active: !c.active });
    notify(t('common.saved'));
    await load();
    await auth.refreshSession();
  } catch (e) {
    notify(errorText(e), 'error');
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
        <template #item.manager="{ item }">
          <template v-if="item.manager">
            <div class="text-body-2 text-truncate">{{ item.manager.name }}</div>
            <div class="text-caption text-medium-emphasis text-truncate" dir="ltr">{{ item.manager.email }}</div>
          </template>
          <span v-else class="text-caption text-disabled">{{ $t('org.noManager') }}</span>
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
          <FormErrorAlert :form="form" />
          <v-form :ref="form.bind" @submit.prevent="save">
          <v-text-field
            v-model="dialog.code"
            :label="$t('company.code') + ' *'"
            :hint="$t('company.codeHint')"
            persistent-hint
            :disabled="!!dialog.id"
            :rules="dialog.id ? [] : [rules.required, rules.handle, rules.maxLength(31)]"
            :error-messages="form.errorsFor('code')"
            dir="ltr"
            class="mb-2"
          />
          <v-text-field v-model="dialog.nameAr" :label="$t('company.nameAr') + ' *'" :rules="[rules.required, rules.maxLength(120)]" :error-messages="form.errorsFor('nameAr')" dir="rtl" />
          <v-text-field v-model="dialog.nameEn" :label="$t('company.nameEn') + ' *'" :rules="[rules.required, rules.maxLength(120)]" :error-messages="form.errorsFor('nameEn')" dir="ltr" />
          <v-select v-model="dialog.managerId" :items="staffItems" :label="$t('company.manager')" :hint="$t('company.managerHint')" persistent-hint :error-messages="form.errorsFor('managerId')" class="mb-2" />
          <v-switch v-if="dialog.id" v-model="dialog.active" :label="$t('company.active')" color="success" hide-details />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="form.busy.value" @click="save">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>
