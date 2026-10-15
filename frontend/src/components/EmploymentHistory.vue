<script setup lang="ts">
/**
 * One employee's employment history — where they worked, in which role and
 * under whom, by effective date — plus the "Transfer / promotion" action.
 * A change dated today or earlier applies at once; a later date waits as
 * "Scheduled" and takes effect on that day (and can be cancelled until then).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useOrgOptions } from '../composables/useOrgOptions';
import { useConfirm } from '../composables/useConfirm';
import { useListsStore } from '../stores/lists';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';

interface Snap { id?: string | null; code?: string | null; ar?: string | null; en?: string | null }
interface Opening { orgUnit: Snap | null; position: Snap | null; manager: Snap | null; status: string; employmentType: string; hireDate: string | null }
export interface HistoryEvent {
  id: string;
  batchId: string;
  category: string;
  oldValue: Snap | null;
  newValue: Snap | Opening | null;
  effectiveDate: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED' | 'FAILED';
  reason: string | null;
  failReason: string | null;
  recordedAt: string;
  createdBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
}

const props = defineProps<{
  employeeId: string;
  canEdit: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();

const { t, locale } = useI18n();
const lists = useListsStore();
const org = useOrgOptions();
const confirm = useConfirm();

const events = ref<HistoryEvent[]>([]);
const loading = ref(true);
const loadError = ref('');

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    events.value = await api.get<HistoryEvent[]>(`/api/employees/${props.employeeId}/history`);
  } catch (e) {
    loadError.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/** One change = the rows sharing a batch (unit + title + manager entered together). */
const batches = computed(() => {
  const map = new Map<string, HistoryEvent[]>();
  for (const e of events.value) map.set(e.batchId, [...(map.get(e.batchId) ?? []), e]);
  return [...map.values()];
});

const ar = computed(() => locale.value.startsWith('ar'));
function snapText(s: Snap | null | undefined): string {
  if (!s || (!s.id && !s.code && !s.ar && !s.en)) return t('history.none');
  return (ar.value ? s.ar : s.en) || s.code || s.ar || s.en || t('history.removed');
}
function valueText(category: string, s: Snap | null | undefined): string {
  if (category === 'STATUS') return s?.code ? (lists.label('EMPLOYEE_STATUS', s.code) ?? s.code) : t('history.none');
  if (category === 'EMPLOYMENT_TYPE') return s?.code ? t(`profile.types.${s.code}`, s.code) : t('history.none');
  if (category === 'HIRE_DATE') return s?.code ?? t('history.none');
  return snapText(s);
}
function openingLines(o: Opening): string[] {
  return [
    `${t('history.categories.ORG_UNIT')}: ${snapText(o.orgUnit)}`,
    `${t('history.categories.POSITION')}: ${snapText(o.position)}`,
    `${t('history.categories.MANAGER')}: ${snapText(o.manager)}`,
    `${t('history.categories.STATUS')}: ${lists.label('EMPLOYEE_STATUS', o.status) ?? o.status}`,
  ];
}
const STATUS_COLOR: Record<string, string> = { SCHEDULED: 'info', APPLIED: 'success', CANCELLED: 'grey', FAILED: 'error' };
const CATEGORY_ICON: Record<string, string> = {
  OPENING: 'flag', ORG_UNIT: 'network', POSITION: 'briefcase', MANAGER: 'user-check',
  STATUS: 'badge-check', EMPLOYMENT_TYPE: 'clock', HIRE_DATE: 'calendar',
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

async function cancelBatch(batch: HistoryEvent[]) {
  const ok = await confirm({
    title: t('history.cancel'),
    message: t('history.cancelConfirm', { date: fmtDate(batch[0]!.effectiveDate) }),
    color: 'error',
    confirmText: t('history.cancel'),
  });
  if (!ok) return;
  try {
    await api.delete(`/api/employees/${props.employeeId}/changes/${batch[0]!.batchId}`);
    await load();
  } catch (e) {
    loadError.value = errorText(e);
  }
}

// ─────────────────────────────────────────── transfer / promotion dialog
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dialog = ref(false);
const draft = ref({ effectiveDate: today(), orgUnitId: null as string | null, positionId: null as string | null, managerId: null as string | null, reason: '' });
const form = useForm();
const isFuture = computed(() => draft.value.effectiveDate > today());

function openDialog() {
  draft.value = { effectiveDate: today(), orgUnitId: null, positionId: null, managerId: null, reason: '' };
  form.reset();
  void org.load();
  dialog.value = true;
}

function save() {
  const d = draft.value;
  if (!d.orgUnitId && !d.positionId && !d.managerId) {
    const msg = t('history.pickOne');
    form.invalid({ orgUnitId: [msg], positionId: [msg], managerId: [msg] }, msg);
    return;
  }
  return form.submit(async () => {
    await api.post(`/api/employees/${props.employeeId}/changes`, {
      effectiveDate: d.effectiveDate,
      ...(d.orgUnitId ? { orgUnitId: d.orgUnitId } : {}),
      ...(d.positionId ? { positionId: d.positionId } : {}),
      ...(d.managerId ? { managerId: d.managerId } : {}),
      ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
    });
    dialog.value = false;
    await load();
    emit('changed');
  });
}

defineExpose({ reload: load });
</script>

<template>
  <v-card>
    <div class="d-flex align-center flex-wrap ga-3 px-4 pt-4">
      <div class="flex-grow-1 min-w-0">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('history.title') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('history.subtitle') }}</p>
      </div>
      <v-btn v-if="canEdit" color="primary" variant="tonal" prepend-icon="arrow-left-right" @click="openDialog">
        {{ $t('history.add') }}
      </v-btn>
    </div>

    <v-card-text>
      <v-alert v-if="loadError" type="error" variant="tonal" density="compact" class="mb-3">{{ loadError }}</v-alert>
      <div v-if="loading" class="py-6 text-center"><v-progress-circular indeterminate color="primary" /></div>
      <div v-else-if="batches.length === 0" class="text-body-2 text-medium-emphasis py-4">{{ $t('history.empty') }}</div>

      <v-timeline v-else density="compact" side="end" truncate-line="both">
        <v-timeline-item
          v-for="batch in batches"
          :key="batch[0]!.batchId"
          size="small"
          :dot-color="STATUS_COLOR[batch[0]!.status]"
          :icon="CATEGORY_ICON[batch[0]!.category] ?? 'circle'"
        >
          <div class="history-row" :class="{ 'history-row--muted': batch[0]!.status === 'CANCELLED' }">
            <div class="d-flex align-center flex-wrap ga-2 mb-1">
              <span class="text-body-2 font-weight-bold">{{ fmtDate(batch[0]!.effectiveDate) }}</span>
              <v-chip size="x-small" :color="STATUS_COLOR[batch[0]!.status]" variant="tonal">
                {{ $t(`history.status.${batch[0]!.status}`) }}
              </v-chip>
              <v-spacer />
              <v-btn
                v-if="canEdit && batch[0]!.status === 'SCHEDULED'"
                size="small"
                variant="text"
                color="error"
                prepend-icon="x"
                @click="cancelBatch(batch)"
              >
                {{ $t('history.cancel') }}
              </v-btn>
            </div>

            <template v-if="batch[0]!.category === 'OPENING'">
              <div class="text-body-2 font-weight-medium">{{ $t('history.categories.OPENING') }}</div>
              <div v-for="line in openingLines(batch[0]!.newValue as Opening)" :key="line" class="text-caption text-medium-emphasis">{{ line }}</div>
            </template>
            <template v-else>
              <div v-for="e in batch" :key="e.id" class="text-body-2">
                <span class="text-medium-emphasis">{{ $t(`history.categories.${e.category}`) }}:</span>
                {{ valueText(e.category, e.oldValue) }}
                <v-icon icon="arrow-right" size="14" class="mx-1 flip-icon" />
                <b>{{ valueText(e.category, e.newValue as Snap) }}</b>
              </div>
            </template>

            <div v-if="batch[0]!.reason && batch[0]!.category !== 'OPENING'" class="text-caption mt-1">{{ batch[0]!.reason }}</div>
            <div v-if="batch[0]!.status === 'FAILED' && batch[0]!.failReason" class="text-caption text-error mt-1">
              {{ $t('history.failed', { reason: batch[0]!.failReason }) }}
            </div>
            <div class="text-caption text-medium-emphasis mt-1">
              <template v-if="batch[0]!.approvedBy">{{ $t('history.by', { name: batch[0]!.approvedBy.name }) }} · </template>
              {{ $t('history.recorded', { date: fmtDate(batch[0]!.recordedAt) }) }}
            </div>
          </div>
        </v-timeline-item>
      </v-timeline>
    </v-card-text>
  </v-card>

  <v-dialog v-model="dialog" max-width="560">
    <v-card :title="$t('history.add')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <v-form :ref="form.bind" @submit.prevent="save">
          <v-text-field
            v-model="draft.effectiveDate"
            type="date"
            :label="$t('history.effectiveDate') + ' *'"
            :rules="[rules.required, rules.date]"
            :error-messages="form.errorsFor('effectiveDate')"
            :hint="isFuture ? $t('history.futureHint') : $t('history.nowHint')"
            persistent-hint
            class="mb-3"
          />
          <p class="text-caption text-medium-emphasis mb-2">{{ $t('history.keepCurrent') }}</p>
          <v-select
            v-model="draft.orgUnitId"
            :items="org.unitItems.value"
            :label="$t('history.newUnit')"
            clearable
            :error-messages="form.errorsFor('orgUnitId')"
          />
          <v-select
            v-model="draft.positionId"
            :items="org.titleItems.value"
            :label="$t('history.newPosition')"
            clearable
            :error-messages="form.errorsFor('positionId')"
          />
          <v-autocomplete
            v-model="draft.managerId"
            :items="org.managerHits.value"
            :label="$t('history.newManager')"
            clearable
            no-filter
            :error-messages="form.errorsFor('managerId')"
            @update:search="(q: string) => org.searchManagers(q, employeeId)"
          />
          <v-textarea
            v-model="draft.reason"
            :label="$t('history.reason')"
            rows="2"
            auto-grow
            :rules="[rules.maxLength(1000)]"
            :error-messages="form.errorsFor('reason')"
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="save">
          {{ isFuture ? $t('history.schedule') : $t('history.applyNow') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.history-row { padding-bottom: 6px; }
.history-row--muted { opacity: 0.6; text-decoration: line-through; text-decoration-color: rgba(var(--v-theme-on-surface), 0.3); }
</style>
