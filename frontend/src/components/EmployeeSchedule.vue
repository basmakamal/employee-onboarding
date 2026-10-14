<script setup lang="ts">
/**
 * One person's work schedule: the next two weeks day by day, and (for staff)
 * the schedules over time — regular ones in sequence, temporary ones on top
 * — with "Assign schedule". My space shows the same days, read-only.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';
import ScheduleStrip, { type Day } from './ScheduleStrip.vue';

interface Assignment {
  id: string;
  startDate: string;
  endDate: string | null;
  temporary: boolean;
  reason: string | null;
  pattern: { id: string; code: string; nameAr: string; nameEn: string; kind: string };
}
interface PatternOption { id: string; code: string; nameAr: string; nameEn: string; active: boolean }

const props = defineProps<{ employeeId: string; canEdit: boolean; self?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { t, locale } = useI18n();
const confirm = useConfirm();

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const start = ref(ymd(new Date()));
const days = ref<Day[]>([]);
const assignments = ref<Assignment[]>([]);
const patterns = ref<PatternOption[]>([]);
const error = ref('');
const ar = computed(() => locale.value.startsWith('ar'));
const nameOf = (x: { nameAr: string; nameEn: string }) => (ar.value ? x.nameAr : x.nameEn);
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : t('schedule.onwards');

function shift(n: number) {
  const d = new Date(`${start.value}T00:00:00`);
  d.setDate(d.getDate() + n);
  start.value = ymd(d);
  void loadDays();
}
async function loadDays() {
  const end = new Date(`${start.value}T00:00:00`);
  end.setDate(end.getDate() + 13);
  const base = props.self ? '/api/me/schedule' : `/api/employees/${props.employeeId}/schedule`;
  try {
    days.value = await api.get<Day[]>(`${base}?from=${start.value}&to=${ymd(end)}`);
  } catch (e) {
    error.value = errorText(e);
  }
}
async function loadAssignments() {
  if (props.self) return;
  try {
    assignments.value = await api.get<Assignment[]>(`/api/employees/${props.employeeId}/schedule-assignments`);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => {
  void loadDays();
  void loadAssignments();
});

// ─────────────────────────────────────── assign
const dialog = ref(false);
const draft = ref({ patternId: null as string | null, startDate: ymd(new Date()), endDate: '', temporary: false, reason: '' });
const form = useForm();
async function openAssign() {
  form.reset();
  draft.value = { patternId: null, startDate: ymd(new Date()), endDate: '', temporary: false, reason: '' };
  try {
    patterns.value = (await api.get<PatternOption[]>('/api/workforce/patterns')).filter((p) => p.active);
  } catch (e) {
    error.value = errorText(e);
  }
  dialog.value = true;
}
function save() {
  return form.submit(async () => {
    const d = draft.value;
    await api.post(`/api/employees/${props.employeeId}/schedule-assignments`, {
      patternId: d.patternId,
      startDate: d.startDate,
      ...(d.endDate ? { endDate: d.endDate } : {}),
      temporary: d.temporary,
      ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
    });
    dialog.value = false;
    await Promise.all([loadDays(), loadAssignments()]);
    emit('changed');
  });
}

// ─────────────────────────────────────── end / remove
const endDialog = ref({ show: false, id: '', endDate: ymd(new Date()) });
const endForm = useForm();
function openEnd(a: Assignment) {
  endForm.reset();
  endDialog.value = { show: true, id: a.id, endDate: ymd(new Date()) };
}
function saveEnd() {
  return endForm.submit(async () => {
    await api.put(`/api/employees/${props.employeeId}/schedule-assignments/${endDialog.value.id}`, { endDate: endDialog.value.endDate });
    endDialog.value.show = false;
    await Promise.all([loadDays(), loadAssignments()]);
    emit('changed');
  });
}
async function remove(a: Assignment) {
  if (!(await confirm({ title: t('schedule.remove'), message: t('schedule.removeConfirm'), color: 'error', confirmText: t('schedule.remove') }))) return;
  try {
    await api.delete(`/api/employees/${props.employeeId}/schedule-assignments/${a.id}`);
    await Promise.all([loadDays(), loadAssignments()]);
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
  }
}
const todayYmd = ymd(new Date());
const inForce = (a: Assignment) => a.startDate.slice(0, 10) <= todayYmd && (!a.endDate || a.endDate.slice(0, 10) >= todayYmd);
</script>

<template>
  <v-card class="mb-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <div class="flex-grow-1">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('schedule.title') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('schedule.subtitle') }}</p>
      </div>
      <v-btn icon="chevron-left" variant="text" size="small" class="flip-rtl" :aria-label="$t('schedule.earlier')" @click="shift(-14)" />
      <v-btn variant="text" size="small" @click="start = ymd(new Date()); loadDays()">{{ $t('schedule.today') }}</v-btn>
      <v-btn icon="chevron-right" variant="text" size="small" class="flip-rtl" :aria-label="$t('schedule.later')" @click="shift(14)" />
      <v-btn v-if="canEdit" color="primary" variant="tonal" prepend-icon="calendar" @click="openAssign">{{ $t('schedule.assign') }}</v-btn>
    </div>
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
      <ScheduleStrip :days="days" />
    </v-card-text>
  </v-card>

  <v-card v-if="!self" :title="$t('schedule.history')" class="mb-4">
    <v-card-text>
      <div v-if="assignments.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('schedule.none') }}</div>
      <div v-for="a in assignments" :key="a.id" class="d-flex align-center flex-wrap ga-2 py-2 arow">
        <v-icon :icon="a.temporary ? 'clock' : 'calendar'" :color="inForce(a) ? 'primary' : undefined" size="18" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">
            {{ nameOf(a.pattern) }} <span class="text-caption text-medium-emphasis">({{ a.pattern.code }})</span>
            <v-chip v-if="a.temporary" size="x-small" variant="tonal" color="info" class="ms-1">{{ $t('schedule.temporary') }}</v-chip>
            <v-chip v-if="inForce(a)" size="x-small" variant="tonal" color="success" class="ms-1">{{ $t('schedule.inForce') }}</v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">{{ fmt(a.startDate) }} → {{ fmt(a.endDate) }}<template v-if="a.reason"> · {{ a.reason }}</template></div>
        </div>
        <template v-if="canEdit">
          <v-btn v-if="a.startDate.slice(0, 10) > todayYmd" size="small" variant="text" color="error" @click="remove(a)">{{ $t('schedule.remove') }}</v-btn>
          <v-btn v-else-if="!a.endDate || a.endDate.slice(0, 10) >= todayYmd" size="small" variant="text" @click="openEnd(a)">{{ $t('schedule.end') }}</v-btn>
        </template>
      </div>
    </v-card-text>
  </v-card>

  <v-dialog v-model="dialog" max-width="520">
    <v-card :title="$t('schedule.assign')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <v-alert v-if="patterns.length === 0" type="info" variant="tonal" density="compact" class="mb-3">{{ $t('schedule.noPatterns') }}</v-alert>
        <v-form :ref="form.bind" @submit.prevent="save">
          <v-select
            v-model="draft.patternId"
            :items="patterns.map((p) => ({ title: `${nameOf(p)} (${p.code})`, value: p.id }))"
            :label="$t('schedule.pattern') + ' *'"
            :rules="[rules.required]"
            :error-messages="form.errorsFor('patternId')"
          />
          <v-switch v-model="draft.temporary" color="primary" hide-details density="comfortable" class="mb-2">
            <template #label>
              <div class="ms-2">
                <div class="text-body-2 font-weight-medium">{{ $t('schedule.temporary') }}</div>
                <div class="text-caption text-medium-emphasis">{{ $t('schedule.temporaryHint') }}</div>
              </div>
            </template>
          </v-switch>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="draft.startDate" type="date" :label="$t('schedule.from') + ' *'" :rules="[rules.required, rules.date]" :error-messages="form.errorsFor('startDate')" /></v-col>
            <v-col cols="6">
              <v-text-field
                v-model="draft.endDate"
                type="date"
                :label="$t('schedule.to') + (draft.temporary ? ' *' : '')"
                :rules="draft.temporary ? [rules.required, rules.date] : [rules.date]"
                :error-messages="form.errorsFor('endDate')"
                :hint="draft.temporary ? '' : $t('schedule.openEndedHint')"
                persistent-hint
              />
            </v-col>
          </v-row>
          <v-textarea v-model="draft.reason" :label="$t('history.reason')" rows="2" auto-grow :error-messages="form.errorsFor('reason')" />
          <p class="text-caption text-medium-emphasis mb-0">{{ $t('schedule.replacesHint') }}</p>
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="form.busy.value" @click="save">{{ $t('schedule.assign') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="endDialog.show" max-width="420">
    <v-card :title="$t('schedule.end')" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="endForm" />
        <v-form :ref="endForm.bind" @submit.prevent="saveEnd">
          <v-text-field v-model="endDialog.endDate" type="date" :label="$t('schedule.lastDay') + ' *'" :rules="[rules.required, rules.date]" :error-messages="endForm.errorsFor('endDate')" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="endDialog.show = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="endForm.busy.value" @click="saveEnd">{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.arow + .arow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
