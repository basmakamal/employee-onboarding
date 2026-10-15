<script setup lang="ts">
/**
 * The Pay tab of the employee file (salary is confidential — only people with
 * compensation.read see this tab). The package in force today, changes
 * scheduled for later, and the history; "Change pay" adds a new version from
 * a date, so past months always keep the pay they had.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';

interface Line { componentId: string; code: string; nameAr: string; nameEn: string; kind: string; method: string; percent: number | null; amount: number }
interface Version {
  id: string;
  effectiveFrom: string;
  state: 'CURRENT' | 'SCHEDULED' | 'PAST';
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
  lines: Line[];
  basic: number;
  earnings: number;
  deductions: number;
  net: number;
  gosiWage: number;
  hourlyWage: number;
  rates: { hourly: number; basicHourly: number; overtimeHourly: number; daily: number };
}
interface Data { today: string; currency: string; contractSalary: unknown; currentId: string | null; versions: Version[] }
interface Component { id: string; code: string; nameAr: string; nameEn: string; kind: string; method: string; defaultPercent: string | null; active: boolean }

const props = defineProps<{ employeeId: string; canEdit: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t, locale } = useI18n();
const confirm = useConfirm();
const ar = computed(() => locale.value.startsWith('ar'));
const nameOf = (x: { nameAr: string; nameEn: string }) => (ar.value ? x.nameAr : x.nameEn);
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });

const base = computed(() => `/api/employees/${props.employeeId}/compensation`);
const data = ref<Data | null>(null);
const components = ref<Component[]>([]);
const error = ref('');

async function load() {
  error.value = '';
  try {
    data.value = await api.get<Data>(base.value);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => void load());

const current = computed(() => data.value?.versions.find((v) => v.state === 'CURRENT') ?? null);
const scheduled = computed(() => (data.value?.versions ?? []).filter((v) => v.state === 'SCHEDULED').reverse());
const past = computed(() => (data.value?.versions ?? []).filter((v) => v.state === 'PAST'));

// ─────────────────────────────────────── change pay
const dialog = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ effectiveFrom: '', reason: '', values: {} as Record<string, string | number> });
const form = useForm();
const earningComponents = computed(() => components.value.filter((c) => c.active));

async function open(from?: Version) {
  form.reset();
  try {
    if (!components.value.length) components.value = await api.get<Component[]>('/api/payroll/components');
  } catch (e) {
    error.value = errorText(e);
    return;
  }
  const source = from ?? current.value ?? scheduled.value[scheduled.value.length - 1] ?? null;
  const values: Record<string, string | number> = {};
  for (const c of components.value) {
    const line = source?.lines.find((l) => l.componentId === c.id);
    values[c.id] = line ? (c.method === 'PERCENT_OF_BASIC' ? (line.percent ?? '') : line.amount) : c.method === 'PERCENT_OF_BASIC' && c.defaultPercent ? Number(c.defaultPercent) : '';
  }
  editingId.value = from?.state === 'SCHEDULED' ? from.id : null;
  const tomorrow = new Date(`${data.value?.today ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  draft.value = {
    effectiveFrom: editingId.value ? from!.effectiveFrom : current.value ? tomorrow.toISOString().slice(0, 10) : (data.value?.today ?? ''),
    reason: editingId.value ? (from!.reason ?? '') : '',
    values,
  };
  dialog.value = true;
}

/** Live total of what is being entered. */
const draftTotal = computed(() => {
  const basicC = components.value.find((c) => c.code === 'BASIC');
  const basic = Number(draft.value.values[basicC?.id ?? ''] || 0);
  let earn = 0;
  let ded = 0;
  for (const c of earningComponents.value) {
    const v = Number(draft.value.values[c.id] || 0);
    const amount = c.method === 'PERCENT_OF_BASIC' ? (basic * v) / 100 : v;
    if (c.kind === 'DEDUCTION') ded += amount;
    else earn += amount;
  }
  return { earn: Math.round(earn * 100) / 100, net: Math.round((earn - ded) * 100) / 100 };
});

function save() {
  return form.submit(async () => {
    const lines = earningComponents.value
      .filter((c) => draft.value.values[c.id] !== '' && draft.value.values[c.id] != null)
      .map((c) => (c.method === 'PERCENT_OF_BASIC' ? { componentId: c.id, percent: Number(draft.value.values[c.id]) } : { componentId: c.id, amount: Number(draft.value.values[c.id]) }));
    const body = { effectiveFrom: draft.value.effectiveFrom, lines, ...(draft.value.reason.trim() ? { reason: draft.value.reason.trim() } : {}) };
    if (editingId.value) await api.put(`${base.value}/${editingId.value}`, body);
    else await api.post(base.value, body);
    dialog.value = false;
    await load();
    emit('changed');
  });
}

async function remove(v: Version) {
  if (!(await confirm({ title: t('pay.removeChange'), message: t('pay.removeConfirm'), color: 'error', confirmText: t('pay.removeChange') }))) return;
  try {
    await api.delete(`${base.value}/${v.id}`);
    await load();
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

  <!-- In force today -->
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <div class="flex-grow-1">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('pay.current') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">
          <template v-if="current">{{ $t('pay.since', { date: fmtDate(current.effectiveFrom) }) }}</template>
          <template v-else>{{ $t('pay.confidential') }}</template>
        </p>
      </div>
      <v-btn v-if="canEdit" color="primary" variant="flat" size="small" prepend-icon="banknote" @click="open()">{{ current || scheduled.length ? $t('pay.change') : $t('pay.setFirst') }}</v-btn>
    </div>
    <v-card-text>
      <div v-if="!data" class="py-4 text-center"><v-progress-circular indeterminate color="primary" /></div>
      <template v-else-if="current">
        <v-table density="compact" class="pay-table">
          <tbody>
            <tr v-for="l in current.lines" :key="l.componentId">
              <td>{{ nameOf(l) }}<span v-if="l.percent !== null" class="text-caption text-medium-emphasis"> ({{ l.percent }}%)</span></td>
              <td class="text-end" :class="{ 'text-error': l.kind === 'DEDUCTION' }"><span dir="ltr">{{ l.kind === 'DEDUCTION' ? '−' : '' }}{{ money(l.amount) }}</span></td>
            </tr>
            <tr class="total">
              <td>{{ $t('pay.gross') }}</td>
              <td class="text-end"><span dir="ltr">{{ money(current.earnings) }} {{ data.currency }}</span></td>
            </tr>
            <tr v-if="current.deductions">
              <td>{{ $t('pay.netBefore') }}</td>
              <td class="text-end"><span dir="ltr">{{ money(current.net) }} {{ data.currency }}</span></td>
            </tr>
          </tbody>
        </v-table>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-chip size="small" variant="tonal">{{ $t('pay.gosiWage') }}: <span dir="ltr" class="ms-1">{{ money(current.gosiWage) }}</span></v-chip>
          <v-chip size="small" variant="tonal">{{ $t('pay.daily') }}: <span dir="ltr" class="ms-1">{{ money(current.rates.daily) }}</span></v-chip>
          <v-chip size="small" variant="tonal">{{ $t('pay.hourly') }}: <span dir="ltr" class="ms-1">{{ money(current.rates.hourly) }}</span></v-chip>
          <v-chip size="small" variant="tonal" color="primary">{{ $t('pay.overtimeHourly') }}: <span dir="ltr" class="ms-1">{{ money(current.rates.overtimeHourly) }}</span></v-chip>
        </div>
      </template>
      <div v-else class="text-body-2 text-medium-emphasis">
        {{ $t('pay.none') }}
        <template v-if="data.contractSalary"> {{ $t('pay.contractSays', { amount: String(data.contractSalary) }) }}</template>
      </div>
    </v-card-text>
  </v-card>

  <!-- Scheduled -->
  <v-card v-if="scheduled.length" :title="$t('pay.scheduled')" class="mb-4">
    <v-card-text>
      <div v-for="v in scheduled" :key="v.id" class="d-flex align-center flex-wrap ga-2 py-2 vrow">
        <v-icon icon="clock" color="info" size="18" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">{{ $t('pay.from', { date: fmtDate(v.effectiveFrom) }) }} · <span dir="ltr">{{ money(v.earnings) }} {{ data?.currency }}</span></div>
          <div class="text-caption text-medium-emphasis">{{ v.lines.map((l) => `${nameOf(l)} ${money(l.amount)}`).join(' · ') }}<template v-if="v.reason"> · {{ v.reason }}</template></div>
        </div>
        <template v-if="canEdit">
          <v-btn size="small" variant="text" @click="open(v)">{{ $t('common.edit') }}</v-btn>
          <v-btn size="small" variant="text" color="error" @click="remove(v)">{{ $t('pay.removeChange') }}</v-btn>
        </template>
      </div>
    </v-card-text>
  </v-card>

  <!-- History -->
  <v-card v-if="past.length || current" :title="$t('pay.history')" class="mb-4">
    <v-card-text>
      <div v-for="v in [...(current ? [current] : []), ...past]" :key="v.id" class="d-flex align-center flex-wrap ga-2 py-2 vrow">
        <v-icon :icon="v.state === 'CURRENT' ? 'circle-check' : 'history'" :color="v.state === 'CURRENT' ? 'success' : undefined" size="18" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">{{ $t('pay.from', { date: fmtDate(v.effectiveFrom) }) }} · <span dir="ltr">{{ money(v.earnings) }} {{ data?.currency }}</span></div>
          <div class="text-caption text-medium-emphasis">
            {{ $t('pay.basicN', { n: money(v.basic) }) }}<template v-if="v.reason"> · {{ v.reason }}</template><template v-if="v.createdBy"> · {{ $t('attendance.enteredBy', { name: v.createdBy }) }}</template>
          </div>
        </div>
      </div>
    </v-card-text>
  </v-card>

  <!-- Change pay -->
  <v-dialog v-model="dialog" max-width="560" scrollable>
    <v-card :title="editingId ? $t('pay.editScheduled') : $t('pay.change')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('pay.changeHint') }}</p>
        <v-form :ref="form.bind" @submit.prevent="save">
          <v-text-field v-model="draft.effectiveFrom" type="date" :label="$t('pay.effectiveFrom') + ' *'" :rules="[rules.required, rules.date]" :error-messages="form.errorsFor('effectiveFrom')" />
          <v-row v-for="c in earningComponents" :key="c.id" dense>
            <v-col cols="12">
              <v-text-field
                v-model="draft.values[c.id]"
                type="number"
                min="0"
                :step="c.method === 'PERCENT_OF_BASIC' ? '0.5' : '0.01'"
                :label="nameOf(c) + (c.code === 'BASIC' ? ' *' : '')"
                :suffix="c.method === 'PERCENT_OF_BASIC' ? $t('pay.percentOfBasic') : (data?.currency ?? 'SAR')"
                :prefix="c.kind === 'DEDUCTION' ? '−' : undefined"
                density="comfortable"
                hide-details="auto"
              />
            </v-col>
          </v-row>
          <div v-if="form.errorsFor('lines').length" class="text-error text-caption mt-1">{{ form.errorsFor('lines')[0] }}</div>
          <v-alert type="info" variant="tonal" density="compact" class="my-3">
            {{ $t('pay.gross') }}: <b dir="ltr">{{ money(draftTotal.earn) }}</b>
            <template v-if="draftTotal.net !== draftTotal.earn"> · {{ $t('pay.netBefore') }}: <b dir="ltr">{{ money(draftTotal.net) }}</b></template>
            <div v-if="data?.contractSalary && !current" class="text-caption">{{ $t('pay.contractSays', { amount: String(data.contractSalary) }) }}</div>
          </v-alert>
          <v-text-field v-model="draft.reason" :label="$t('pay.reason')" :hint="$t('pay.reasonHint')" persistent-hint :error-messages="form.errorsFor('reason')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="save">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pay-table tr.total td { font-weight: 700; border-top: 2px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.vrow + .vrow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
