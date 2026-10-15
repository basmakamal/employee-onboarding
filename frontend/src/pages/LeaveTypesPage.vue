<script setup lang="ts">
/**
 * Leave types and their rules for the selected company. The built-in types
 * follow the Saudi Labour Law as defaults — HR confirms or edits them; they
 * can be switched off but not deleted. Every number here is data the leave
 * calculation reads, nothing is hard-coded.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { useAuthStore } from '../stores/auth';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';

interface Tier { days: number; percent: number }
interface LeaveType {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  color: string | null;
  paidPercent: number;
  balanceMode: 'ACCRUAL' | 'NONE';
  accrual: 'MONTHLY' | 'YEARLY' | null;
  daysPerYear: string | null;
  seniorDaysPerYear: string | null;
  seniorAfterYears: number | null;
  carryForwardMax: string | null;
  yearlyLimit: number | null;
  payTiers: Tier[] | null;
  maxPerRequest: number | null;
  oncePerService: boolean;
  minServiceMonths: number | null;
  gender: 'ANY' | 'FEMALE' | 'MALE';
  countMode: 'WORKING' | 'CALENDAR';
  allowHalfDay: boolean;
  system: boolean;
  active: boolean;
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const confirm = useConfirm();
const companyName = useActiveCompanyName();
const canEdit = computed(() => auth.can('leave.manage'));
const ar = computed(() => locale.value.startsWith('ar'));
const rows = ref<LeaveType[]>([]);
const error = ref('');

async function load() {
  error.value = '';
  try {
    rows.value = await api.get<LeaveType[]>('/api/leave/types');
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());

const numOrNull = (v: unknown) => (v === '' || v == null ? null : Number(v));
const summary = (x: LeaveType) => {
  const parts: string[] = [];
  if (x.balanceMode === 'ACCRUAL') {
    parts.push(t('leaveTypes.sumAccrual', { n: Number(x.daysPerYear), how: t(`leaveTypes.accruals.${x.accrual}`) }));
    if (x.seniorDaysPerYear) parts.push(t('leaveTypes.sumSenior', { n: Number(x.seniorDaysPerYear), years: x.seniorAfterYears }));
    if (x.carryForwardMax != null) parts.push(t('leaveTypes.sumCarry', { n: Number(x.carryForwardMax) }));
  }
  if (x.maxPerRequest) parts.push(t('leaveTypes.sumMax', { n: x.maxPerRequest }));
  if (x.yearlyLimit) parts.push(t('leaveTypes.sumYearly', { n: x.yearlyLimit }));
  if (x.oncePerService) parts.push(t('leaveTypes.sumOnce'));
  if (x.minServiceMonths) parts.push(t('leaveTypes.sumService', { n: x.minServiceMonths }));
  if (x.gender !== 'ANY') parts.push(t(`leaveTypes.genders.${x.gender}`));
  return parts.join(' · ');
};
const payText = (x: LeaveType) =>
  x.payTiers?.length ? x.payTiers.map((p) => `${p.days}d ${p.percent}%`).join(' → ') : `${x.paidPercent}%`;

// ─────────────────────────────────────── edit
const dialog = ref(false);
const editingId = ref<string | null>(null);
const editingSystem = ref(false);
const empty = () => ({
  code: '', nameAr: '', nameEn: '', color: '#5b3fd1', paidPercent: 100, balanceMode: 'NONE' as 'ACCRUAL' | 'NONE', accrual: 'MONTHLY' as 'MONTHLY' | 'YEARLY',
  daysPerYear: '' as string | number, seniorDaysPerYear: '' as string | number, seniorAfterYears: '' as string | number, carryForwardMax: '' as string | number,
  yearlyLimit: '' as string | number, tiers: [] as Tier[], maxPerRequest: '' as string | number, oncePerService: false, minServiceMonths: '' as string | number,
  gender: 'ANY' as 'ANY' | 'FEMALE' | 'MALE', countMode: 'WORKING' as 'WORKING' | 'CALENDAR', allowHalfDay: false, active: true,
});
const draft = ref(empty());
const form = useForm();
function openNew() {
  form.reset();
  editingId.value = null;
  editingSystem.value = false;
  draft.value = empty();
  dialog.value = true;
}
function openEdit(x: LeaveType) {
  form.reset();
  editingId.value = x.id;
  editingSystem.value = x.system;
  draft.value = {
    code: x.code, nameAr: x.nameAr, nameEn: x.nameEn, color: x.color ?? '#5b3fd1', paidPercent: x.paidPercent, balanceMode: x.balanceMode, accrual: x.accrual ?? 'MONTHLY',
    daysPerYear: x.daysPerYear ?? '', seniorDaysPerYear: x.seniorDaysPerYear ?? '', seniorAfterYears: x.seniorAfterYears ?? '', carryForwardMax: x.carryForwardMax ?? '',
    yearlyLimit: x.yearlyLimit ?? '', tiers: (x.payTiers ?? []).map((p) => ({ ...p })), maxPerRequest: x.maxPerRequest ?? '', oncePerService: x.oncePerService,
    minServiceMonths: x.minServiceMonths ?? '', gender: x.gender, countMode: x.countMode, allowHalfDay: x.allowHalfDay, active: x.active,
  };
  dialog.value = true;
}
function save() {
  return form.submit(async () => {
    const d = draft.value;
    const accrues = d.balanceMode === 'ACCRUAL';
    const body = {
      code: d.code.trim(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), color: d.color || null, paidPercent: Number(d.paidPercent),
      balanceMode: d.balanceMode,
      accrual: accrues ? d.accrual : null,
      daysPerYear: accrues ? numOrNull(d.daysPerYear) : null,
      seniorDaysPerYear: accrues ? numOrNull(d.seniorDaysPerYear) : null,
      seniorAfterYears: accrues ? numOrNull(d.seniorAfterYears) : null,
      carryForwardMax: accrues ? numOrNull(d.carryForwardMax) : null,
      yearlyLimit: numOrNull(d.yearlyLimit),
      payTiers: d.tiers.length ? d.tiers.map((p) => ({ days: Number(p.days), percent: Number(p.percent) })) : null,
      maxPerRequest: numOrNull(d.maxPerRequest),
      oncePerService: d.oncePerService,
      minServiceMonths: numOrNull(d.minServiceMonths),
      gender: d.gender, countMode: d.countMode, allowHalfDay: d.allowHalfDay, active: d.active,
    };
    if (editingId.value) await api.put(`/api/leave/types/${editingId.value}`, body);
    else await api.post('/api/leave/types', body);
    dialog.value = false;
    await load();
  });
}
async function remove(x: LeaveType) {
  if (!(await confirm({ title: t('leaveTypes.delete'), message: t('leaveTypes.deleteConfirm'), color: 'error', confirmText: t('leaveTypes.delete') }))) return;
  try {
    await api.delete(`/api/leave/types/${x.id}`);
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('leaveTypes.title')" :subtitle="$t('leaveTypes.subtitle', { company: companyName })">
      <v-btn v-if="canEdit" color="primary" prepend-icon="plus" @click="openNew">{{ $t('leaveTypes.new') }}</v-btn>
    </PageHeader>
    <v-alert type="info" variant="tonal" density="compact" class="mb-4">{{ $t('leaveTypes.defaultsNote') }}</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-table>
        <thead>
          <tr>
            <th>{{ $t('leave.type') }}</th>
            <th>{{ $t('leaveTypes.rules') }}</th>
            <th>{{ $t('leaveTypes.pay') }}</th>
            <th>{{ $t('leaveTypes.counting') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in rows" :key="x.id" :class="{ 'text-disabled': !x.active }">
            <td class="py-2">
              <div class="d-flex align-center ga-2">
                <span class="dot" :style="{ background: x.color ?? '#5b3fd1' }" />
                <div>
                  <div class="font-weight-medium">{{ ar ? x.nameAr : x.nameEn }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ x.code }}
                    <v-chip v-if="!x.active" size="x-small" variant="tonal" class="ms-1">{{ $t('leaveTypes.off') }}</v-chip>
                  </div>
                </div>
              </div>
            </td>
            <td class="text-body-2">{{ summary(x) || '—' }}</td>
            <td class="text-body-2" dir="ltr">{{ payText(x) }}</td>
            <td class="text-body-2">{{ $t(`leaveTypes.countModes.${x.countMode}`) }}<template v-if="x.allowHalfDay"> · {{ $t('leave.halfDay') }}</template></td>
            <td class="text-end text-no-wrap">
              <template v-if="canEdit">
                <v-btn icon="pencil" size="small" variant="text" :aria-label="$t('common.edit')" @click="openEdit(x)" />
                <v-btn v-if="!x.system" icon="trash-2" size="small" variant="text" color="error" :aria-label="$t('leaveTypes.delete')" @click="remove(x)" />
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-dialog v-model="dialog" max-width="640" scrollable>
      <v-card :title="editingId ? $t('leaveTypes.edit') : $t('leaveTypes.new')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <v-form :ref="form.bind" @submit.prevent="save">
            <v-row dense>
              <v-col cols="12" sm="4"><v-text-field v-model="draft.code" :label="$t('leaveTypes.code') + ' *'" :disabled="editingSystem" :rules="[rules.required]" :error-messages="form.errorsFor('code')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="draft.nameAr" :label="$t('leaveTypes.nameAr') + ' *'" :rules="[rules.required]" :error-messages="form.errorsFor('nameAr')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="draft.nameEn" :label="$t('leaveTypes.nameEn') + ' *'" :rules="[rules.required]" :error-messages="form.errorsFor('nameEn')" /></v-col>
            </v-row>
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select
                  v-model="draft.balanceMode"
                  :items="['ACCRUAL', 'NONE'].map((v) => ({ title: $t(`leaveTypes.modes.${v}`), value: v }))"
                  :label="$t('leaveTypes.balanceMode')"
                  :error-messages="form.errorsFor('balanceMode')"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="draft.countMode" :items="['WORKING', 'CALENDAR'].map((v) => ({ title: $t(`leaveTypes.countModes.${v}`), value: v }))" :label="$t('leaveTypes.counting')" />
              </v-col>
            </v-row>
            <v-row v-if="draft.balanceMode === 'ACCRUAL'" dense>
              <v-col cols="6" sm="3"><v-select v-model="draft.accrual" :items="['MONTHLY', 'YEARLY'].map((v) => ({ title: $t(`leaveTypes.accruals.${v}`), value: v }))" :label="$t('leaveTypes.accrual')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.daysPerYear" type="number" :label="$t('leaveTypes.daysPerYear') + ' *'" :error-messages="form.errorsFor('daysPerYear')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.seniorDaysPerYear" type="number" :label="$t('leaveTypes.seniorDays')" :error-messages="form.errorsFor('seniorDaysPerYear')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.seniorAfterYears" type="number" :label="$t('leaveTypes.seniorAfter')" :error-messages="form.errorsFor('seniorAfterYears')" /></v-col>
              <v-col cols="12" sm="6"><v-text-field v-model="draft.carryForwardMax" type="number" :label="$t('leaveTypes.carryMax')" :hint="$t('leaveTypes.carryHint')" persistent-hint /></v-col>
            </v-row>
            <v-row dense>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.maxPerRequest" type="number" :label="$t('leaveTypes.maxPerRequest')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.yearlyLimit" type="number" :label="$t('leaveTypes.yearlyLimit')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="draft.minServiceMonths" type="number" :label="$t('leaveTypes.minService')" /></v-col>
              <v-col cols="6" sm="3"><v-select v-model="draft.gender" :items="['ANY', 'FEMALE', 'MALE'].map((v) => ({ title: $t(`leaveTypes.genders.${v}`), value: v }))" :label="$t('leaveTypes.gender')" /></v-col>
            </v-row>

            <div class="text-subtitle-2 mt-2 mb-1">{{ $t('leaveTypes.pay') }}</div>
            <v-row v-if="draft.tiers.length === 0" dense>
              <v-col cols="6" sm="4"><v-text-field v-model="draft.paidPercent" type="number" min="0" max="100" suffix="%" :label="$t('leaveTypes.paidPercent')" /></v-col>
              <v-col cols="6" sm="8" class="d-flex align-center">
                <v-btn variant="text" size="small" prepend-icon="plus" @click="draft.tiers.push({ days: 30, percent: 100 })">{{ $t('leaveTypes.addTier') }}</v-btn>
              </v-col>
            </v-row>
            <template v-else>
              <p class="text-caption text-medium-emphasis mb-1">{{ $t('leaveTypes.tiersHint') }}</p>
              <v-row v-for="(tier, i) in draft.tiers" :key="i" dense>
                <v-col cols="5"><v-text-field v-model.number="tier.days" type="number" :label="$t('leaveTypes.tierDays')" density="compact" /></v-col>
                <v-col cols="5"><v-text-field v-model.number="tier.percent" type="number" suffix="%" :label="$t('leaveTypes.paidPercent')" density="compact" /></v-col>
                <v-col cols="2" class="d-flex align-center"><v-btn icon="x" size="small" variant="text" :aria-label="$t('leaveTypes.delete')" @click="draft.tiers.splice(i, 1)" /></v-col>
              </v-row>
              <v-btn variant="text" size="small" prepend-icon="plus" @click="draft.tiers.push({ days: 30, percent: 0 })">{{ $t('leaveTypes.addTier') }}</v-btn>
            </template>

            <div class="d-flex flex-wrap ga-4 mt-2">
              <v-switch v-model="draft.allowHalfDay" :label="$t('leaveTypes.allowHalfDay')" color="primary" hide-details density="compact" />
              <v-switch v-model="draft.oncePerService" :label="$t('leaveTypes.oncePerService')" color="primary" hide-details density="compact" />
              <v-switch v-model="draft.active" :label="$t('leaveTypes.active')" color="primary" hide-details density="compact" />
            </div>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="save">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 12px; }
</style>
