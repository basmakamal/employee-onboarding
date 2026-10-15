<script setup lang="ts">
/**
 * Payroll setup of the selected company: the pay components (what can
 * appear on a payslip) and the payroll rules — cut-off and pay days, how a
 * partial month is prorated, the hourly-rate basis, the overtime premium and
 * GOSI rates. Rules are versioned by date: a change applies from a day on,
 * past months keep theirs. GOSI rates stay empty until HR enters them.
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

interface Component {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  kind: 'EARNING' | 'DEDUCTION';
  method: 'FIXED' | 'PERCENT_OF_BASIC';
  defaultPercent: string | null;
  gosiBase: boolean;
  prorated: boolean;
  hourlyBase: boolean;
  sortOrder: number;
  system: boolean;
  active: boolean;
}
interface Policy {
  id: string;
  effectiveFrom: string;
  cutoffDay: number;
  payDay: number;
  proration: 'WORKING_DAYS' | 'CALENDAR_DAYS' | 'THIRTY_DAYS';
  rateDaysPerMonth: number;
  hoursPerDay: string;
  overtimePremiumPct: string;
  gosiSaudiEmployeePct: string | null;
  gosiSaudiEmployerPct: string | null;
  gosiNonSaudiEmployerPct: string | null;
  gosiWageCap: string | null;
  roundingDecimals: number;
  note: string | null;
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const confirm = useConfirm();
const companyName = useActiveCompanyName();
const canEdit = computed(() => auth.can('payroll.manage'));
const ar = computed(() => locale.value.startsWith('ar'));
const tab = ref<'components' | 'rules'>('components');
const components = ref<Component[]>([]);
const policies = ref<Policy[]>([]);
const error = ref('');
const today = new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) =>
  d.startsWith('2000-01-01') ? t('paySetup.always') : new Date(d).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

async function load() {
  error.value = '';
  try {
    [components.value, policies.value] = await Promise.all([api.get<Component[]>('/api/payroll/components'), api.get<Policy[]>('/api/payroll/policy')]);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());
const currentPolicy = computed(() => policies.value.find((p) => p.effectiveFrom.slice(0, 10) <= today) ?? policies.value[policies.value.length - 1] ?? null);
const gosiMissing = computed(() => !!currentPolicy.value && currentPolicy.value.gosiSaudiEmployeePct == null);

// ─────────────────────────────────────── components
const cDialog = ref(false);
const cEditing = ref<Component | null>(null);
const cDraft = ref({ code: '', nameAr: '', nameEn: '', kind: 'EARNING' as 'EARNING' | 'DEDUCTION', method: 'FIXED' as 'FIXED' | 'PERCENT_OF_BASIC', defaultPercent: '' as string | number, gosiBase: false, prorated: true, hourlyBase: true, sortOrder: 100, active: true });
const cForm = useForm();
function openComponent(c?: Component) {
  cForm.reset();
  cEditing.value = c ?? null;
  cDraft.value = c
    ? { code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, kind: c.kind, method: c.method, defaultPercent: c.defaultPercent ?? '', gosiBase: c.gosiBase, prorated: c.prorated, hourlyBase: c.hourlyBase, sortOrder: c.sortOrder, active: c.active }
    : { code: '', nameAr: '', nameEn: '', kind: 'EARNING', method: 'FIXED', defaultPercent: '', gosiBase: false, prorated: true, hourlyBase: true, sortOrder: 100, active: true };
  cDialog.value = true;
}
function saveComponent() {
  return cForm.submit(async () => {
    const d = cDraft.value;
    const body = { ...d, defaultPercent: d.method === 'PERCENT_OF_BASIC' && d.defaultPercent !== '' ? Number(d.defaultPercent) : null, sortOrder: Number(d.sortOrder) };
    if (cEditing.value) await api.put(`/api/payroll/components/${cEditing.value.id}`, body);
    else await api.post('/api/payroll/components', body);
    cDialog.value = false;
    await load();
  });
}
async function removeComponent(c: Component) {
  if (!(await confirm({ title: t('paySetup.deleteComponent'), message: t('paySetup.deleteComponentConfirm'), color: 'error', confirmText: t('paySetup.deleteComponent') }))) return;
  try {
    await api.delete(`/api/payroll/components/${c.id}`);
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ─────────────────────────────────────── rules
const pDialog = ref(false);
const pDraft = ref({ effectiveFrom: today, cutoffDay: 25, payDay: 27, proration: 'WORKING_DAYS', rateDaysPerMonth: 30, hoursPerDay: 8, overtimePremiumPct: 50, gosiSaudiEmployeePct: '' as string | number, gosiSaudiEmployerPct: '' as string | number, gosiNonSaudiEmployerPct: '' as string | number, gosiWageCap: '' as string | number, roundingDecimals: 2, note: '' });
const pForm = useForm();
const opt = (v: string | number | null) => (v === '' || v == null ? null : Number(v));
function openRules() {
  pForm.reset();
  const p = currentPolicy.value;
  pDraft.value = {
    effectiveFrom: today,
    cutoffDay: p?.cutoffDay ?? 25,
    payDay: p?.payDay ?? 27,
    proration: p?.proration ?? 'WORKING_DAYS',
    rateDaysPerMonth: p?.rateDaysPerMonth ?? 30,
    hoursPerDay: Number(p?.hoursPerDay ?? 8),
    overtimePremiumPct: Number(p?.overtimePremiumPct ?? 50),
    gosiSaudiEmployeePct: p?.gosiSaudiEmployeePct ?? '',
    gosiSaudiEmployerPct: p?.gosiSaudiEmployerPct ?? '',
    gosiNonSaudiEmployerPct: p?.gosiNonSaudiEmployerPct ?? '',
    gosiWageCap: p?.gosiWageCap ?? '',
    roundingDecimals: p?.roundingDecimals ?? 2,
    note: '',
  };
  pDialog.value = true;
}
function saveRules() {
  return pForm.submit(async () => {
    const d = pDraft.value;
    await api.post('/api/payroll/policy', {
      effectiveFrom: d.effectiveFrom,
      cutoffDay: Number(d.cutoffDay),
      payDay: Number(d.payDay),
      proration: d.proration,
      rateDaysPerMonth: Number(d.rateDaysPerMonth),
      hoursPerDay: Number(d.hoursPerDay),
      overtimePremiumPct: Number(d.overtimePremiumPct),
      gosiSaudiEmployeePct: opt(d.gosiSaudiEmployeePct),
      gosiSaudiEmployerPct: opt(d.gosiSaudiEmployerPct),
      gosiNonSaudiEmployerPct: opt(d.gosiNonSaudiEmployerPct),
      gosiWageCap: opt(d.gosiWageCap),
      roundingDecimals: Number(d.roundingDecimals),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
    pDialog.value = false;
    await load();
  });
}
const pct = (v: string | null) => (v == null ? t('paySetup.notSet') : `${Number(v)}%`);
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('paySetup.title')" :subtitle="$t('paySetup.subtitle', { company: companyName })" />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="gosiMissing" type="warning" variant="tonal" density="compact" class="mb-4">{{ $t('paySetup.gosiMissing') }}</v-alert>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="components" prepend-icon="list">{{ $t('paySetup.components') }}</v-tab>
      <v-tab value="rules" prepend-icon="settings">{{ $t('paySetup.rules') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab" :touch="false">
      <v-window-item value="components">
        <v-card>
          <div class="d-flex align-center px-4 pt-4">
            <p class="text-body-2 text-medium-emphasis flex-grow-1 mb-0">{{ $t('paySetup.componentsHint') }}</p>
            <v-btn v-if="canEdit" color="primary" size="small" prepend-icon="plus" @click="openComponent()">{{ $t('paySetup.newComponent') }}</v-btn>
          </div>
          <v-table>
            <thead>
              <tr>
                <th>{{ $t('paySetup.component') }}</th>
                <th>{{ $t('paySetup.kind') }}</th>
                <th>{{ $t('paySetup.method') }}</th>
                <th>{{ $t('paySetup.counts') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in components" :key="c.id" :class="{ 'text-disabled': !c.active }">
                <td class="py-2">
                  <div class="font-weight-medium">{{ ar ? c.nameAr : c.nameEn }}</div>
                  <div class="text-caption text-medium-emphasis">{{ c.code }}<v-chip v-if="!c.active" size="x-small" class="ms-1">{{ $t('leaveTypes.off') }}</v-chip></div>
                </td>
                <td><v-chip size="x-small" variant="tonal" :color="c.kind === 'EARNING' ? 'success' : 'error'">{{ $t(`paySetup.kinds.${c.kind}`) }}</v-chip></td>
                <td class="text-body-2">{{ $t(`paySetup.methods.${c.method}`) }}<template v-if="c.defaultPercent"> ({{ Number(c.defaultPercent) }}%)</template></td>
                <td class="text-body-2">
                  <div class="d-flex flex-wrap ga-1">
                    <v-chip v-if="c.gosiBase" size="x-small" variant="outlined">{{ $t('paySetup.gosiBase') }}</v-chip>
                    <v-chip v-if="c.hourlyBase" size="x-small" variant="outlined">{{ $t('paySetup.hourlyBase') }}</v-chip>
                    <v-chip v-if="c.prorated" size="x-small" variant="outlined">{{ $t('paySetup.prorated') }}</v-chip>
                  </div>
                </td>
                <td class="text-end text-no-wrap">
                  <template v-if="canEdit">
                    <v-btn icon="pencil" size="small" variant="text" :aria-label="$t('common.edit')" @click="openComponent(c)" />
                    <v-btn v-if="!c.system" icon="trash-2" size="small" variant="text" color="error" :aria-label="$t('paySetup.deleteComponent')" @click="removeComponent(c)" />
                  </template>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <v-window-item value="rules">
        <v-card v-if="currentPolicy" class="mb-4">
          <div class="d-flex align-center px-4 pt-4">
            <div class="flex-grow-1">
              <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('paySetup.inForce') }}</h3>
              <p class="text-caption text-medium-emphasis mb-0">{{ $t('paySetup.since', { date: fmtDate(currentPolicy.effectiveFrom) }) }}</p>
            </div>
            <v-btn v-if="canEdit" color="primary" size="small" prepend-icon="pencil" @click="openRules">{{ $t('paySetup.changeRules') }}</v-btn>
          </div>
          <v-card-text>
            <dl class="facts">
              <dt>{{ $t('paySetup.cutoffDay') }}</dt><dd>{{ currentPolicy.cutoffDay }}</dd>
              <dt>{{ $t('paySetup.payDay') }}</dt><dd>{{ currentPolicy.payDay }}</dd>
              <dt>{{ $t('paySetup.proration') }}</dt><dd>{{ $t(`paySetup.prorations.${currentPolicy.proration}`) }}</dd>
              <dt>{{ $t('paySetup.hourlyBasis') }}</dt><dd>{{ $t('paySetup.hourlyBasisValue', { days: currentPolicy.rateDaysPerMonth, hours: Number(currentPolicy.hoursPerDay) }) }}</dd>
              <dt>{{ $t('paySetup.overtimePremium') }}</dt><dd>{{ $t('paySetup.overtimePremiumValue', { n: Number(currentPolicy.overtimePremiumPct) }) }}</dd>
              <dt>{{ $t('paySetup.gosiSaudiEmployee') }}</dt><dd>{{ pct(currentPolicy.gosiSaudiEmployeePct) }}</dd>
              <dt>{{ $t('paySetup.gosiSaudiEmployer') }}</dt><dd>{{ pct(currentPolicy.gosiSaudiEmployerPct) }}</dd>
              <dt>{{ $t('paySetup.gosiNonSaudiEmployer') }}</dt><dd>{{ pct(currentPolicy.gosiNonSaudiEmployerPct) }}</dd>
              <dt>{{ $t('paySetup.gosiCap') }}</dt><dd dir="ltr">{{ currentPolicy.gosiWageCap ? Number(currentPolicy.gosiWageCap).toLocaleString() : $t('paySetup.noCap') }}</dd>
            </dl>
          </v-card-text>
        </v-card>
        <v-card v-if="policies.length > 1" :title="$t('paySetup.versions')">
          <v-card-text>
            <div v-for="p in policies" :key="p.id" class="text-body-2 py-1">
              <b>{{ fmtDate(p.effectiveFrom) }}</b>
              <v-chip v-if="p.id === currentPolicy?.id" size="x-small" color="success" variant="tonal" class="ms-1">{{ $t('schedule.inForce') }}</v-chip>
              <v-chip v-else-if="p.effectiveFrom.slice(0, 10) > today" size="x-small" color="info" variant="tonal" class="ms-1">{{ $t('pay.scheduledChip') }}</v-chip>
              <span v-if="p.note && p.note !== 'default'" class="text-medium-emphasis"> · {{ p.note }}</span>
            </div>
          </v-card-text>
        </v-card>
      </v-window-item>
    </v-window>

    <!-- Component dialog -->
    <v-dialog v-model="cDialog" max-width="560">
      <v-card :title="cEditing ? $t('paySetup.editComponent') : $t('paySetup.newComponent')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="cForm" />
          <v-form :ref="cForm.bind" @submit.prevent="saveComponent">
            <v-row dense>
              <v-col cols="12" sm="4"><v-text-field v-model="cDraft.code" :label="$t('leaveTypes.code') + ' *'" :disabled="cEditing?.system" :rules="[rules.required]" :error-messages="cForm.errorsFor('code')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="cDraft.nameAr" :label="$t('leaveTypes.nameAr') + ' *'" :rules="[rules.required]" :error-messages="cForm.errorsFor('nameAr')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="cDraft.nameEn" :label="$t('leaveTypes.nameEn') + ' *'" :rules="[rules.required]" :error-messages="cForm.errorsFor('nameEn')" /></v-col>
            </v-row>
            <v-row dense>
              <v-col cols="12" sm="6">
                <v-select v-model="cDraft.kind" :disabled="cEditing?.code === 'BASIC'" :items="['EARNING', 'DEDUCTION'].map((v) => ({ title: $t(`paySetup.kinds.${v}`), value: v }))" :label="$t('paySetup.kind')" :error-messages="cForm.errorsFor('kind')" />
              </v-col>
              <v-col cols="12" sm="6">
                <v-select v-model="cDraft.method" :disabled="cEditing?.code === 'BASIC'" :items="['FIXED', 'PERCENT_OF_BASIC'].map((v) => ({ title: $t(`paySetup.methods.${v}`), value: v }))" :label="$t('paySetup.method')" :error-messages="cForm.errorsFor('method')" />
              </v-col>
              <v-col v-if="cDraft.method === 'PERCENT_OF_BASIC'" cols="12" sm="6">
                <v-text-field v-model="cDraft.defaultPercent" type="number" suffix="%" :label="$t('paySetup.defaultPercent')" :hint="$t('paySetup.defaultPercentHint')" persistent-hint :error-messages="cForm.errorsFor('defaultPercent')" />
              </v-col>
              <v-col cols="12" sm="6"><v-text-field v-model="cDraft.sortOrder" type="number" :label="$t('paySetup.sortOrder')" /></v-col>
            </v-row>
            <div class="d-flex flex-wrap ga-4">
              <v-switch v-if="cDraft.kind === 'EARNING'" v-model="cDraft.gosiBase" :label="$t('paySetup.gosiBase')" color="primary" hide-details density="compact" />
              <v-switch v-if="cDraft.kind === 'EARNING'" v-model="cDraft.hourlyBase" :label="$t('paySetup.hourlyBase')" color="primary" hide-details density="compact" />
              <v-switch v-model="cDraft.prorated" :label="$t('paySetup.prorated')" color="primary" hide-details density="compact" />
              <v-switch v-if="cEditing?.code !== 'BASIC'" v-model="cDraft.active" :label="$t('leaveTypes.active')" color="primary" hide-details density="compact" />
            </div>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="cForm.busy.value" @click="saveComponent">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Rules dialog -->
    <v-dialog v-model="pDialog" max-width="620" scrollable>
      <v-card :title="$t('paySetup.changeRules')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="pForm" />
          <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('paySetup.rulesHint') }}</p>
          <v-form :ref="pForm.bind" @submit.prevent="saveRules">
            <v-text-field v-model="pDraft.effectiveFrom" type="date" :label="$t('pay.effectiveFrom') + ' *'" :rules="[rules.required, rules.date]" :error-messages="pForm.errorsFor('effectiveFrom')" />
            <v-row dense>
              <v-col cols="6"><v-text-field v-model="pDraft.cutoffDay" type="number" min="1" max="28" :label="$t('paySetup.cutoffDay')" :hint="$t('paySetup.cutoffHint')" persistent-hint :error-messages="pForm.errorsFor('cutoffDay')" /></v-col>
              <v-col cols="6"><v-text-field v-model="pDraft.payDay" type="number" min="1" max="28" :label="$t('paySetup.payDay')" :error-messages="pForm.errorsFor('payDay')" /></v-col>
              <v-col cols="12">
                <v-select v-model="pDraft.proration" :items="['WORKING_DAYS', 'CALENDAR_DAYS', 'THIRTY_DAYS'].map((v) => ({ title: $t(`paySetup.prorations.${v}`), value: v }))" :label="$t('paySetup.proration')" />
              </v-col>
              <v-col cols="4"><v-text-field v-model="pDraft.rateDaysPerMonth" type="number" :label="$t('paySetup.rateDays')" /></v-col>
              <v-col cols="4"><v-text-field v-model="pDraft.hoursPerDay" type="number" step="0.5" :label="$t('paySetup.hoursPerDay')" /></v-col>
              <v-col cols="4"><v-text-field v-model="pDraft.overtimePremiumPct" type="number" suffix="%" :label="$t('paySetup.overtimePremium')" /></v-col>
            </v-row>
            <div class="text-subtitle-2 mt-2 mb-1">{{ $t('paySetup.gosi') }}</div>
            <p class="text-caption text-medium-emphasis mb-2">{{ $t('paySetup.gosiHint') }}</p>
            <v-row dense>
              <v-col cols="6" sm="3"><v-text-field v-model="pDraft.gosiSaudiEmployeePct" type="number" step="0.25" suffix="%" :label="$t('paySetup.gosiSaudiEmployee')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="pDraft.gosiSaudiEmployerPct" type="number" step="0.25" suffix="%" :label="$t('paySetup.gosiSaudiEmployer')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="pDraft.gosiNonSaudiEmployerPct" type="number" step="0.25" suffix="%" :label="$t('paySetup.gosiNonSaudiEmployer')" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="pDraft.gosiWageCap" type="number" :label="$t('paySetup.gosiCap')" /></v-col>
            </v-row>
            <v-text-field v-model="pDraft.note" :label="$t('pay.reason')" />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="pDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="pForm.busy.value" @click="saveRules">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.facts { display: grid; grid-template-columns: minmax(160px, max-content) 1fr; gap: 8px 24px; margin: 0; }
.facts dt { color: rgba(var(--v-theme-on-surface), 0.6); }
.facts dd { margin: 0; font-weight: 500; }
</style>
