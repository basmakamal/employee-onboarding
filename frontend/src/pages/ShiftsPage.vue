<script setup lang="ts">
/**
 * Shifts & patterns of the selected company. A shift is a reusable block of
 * work (08:00–16:00, 22:00–06:00 overnight…); a pattern says which shift(s)
 * fall on which day — weekly, or a rotation of N days. People are then put
 * on a pattern from their employee file.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useForm } from '../composables/useForm';
import { useConfirm } from '../composables/useConfirm';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useAuthStore } from '../stores/auth';
import { rules } from '../validation/rules';
import { errorText } from '../validation/errors';

interface Shift {
  id: string; code: string; nameAr: string; nameEn: string; kind: 'FIXED' | 'FLEXIBLE';
  startTime: string; endTime: string; breakMinutes: number; graceMinutes: number; requiredMinutes: number | null; color: string | null; active: boolean;
}
interface Pattern {
  id: string; code: string; nameAr: string; nameEn: string; kind: 'WEEKLY' | 'ROTATION'; cycleDays: number; days: string[][]; active: boolean;
  _count: { assignments: number };
}

const { t, locale } = useI18n();
const auth = useAuthStore();
const confirm = useConfirm();
const companyName = useActiveCompanyName();
const canEdit = computed(() => auth.can('schedule.manage'));
const tab = ref<'shifts' | 'patterns'>('shifts');
const shifts = ref<Shift[]>([]);
const patterns = ref<Pattern[]>([]);
const loading = ref(true);
const snackbar = ref({ show: false, text: '', color: 'success' });
const notify = (text: string, color = 'success') => (snackbar.value = { show: true, text, color });

async function load() {
  loading.value = true;
  try {
    [shifts.value, patterns.value] = await Promise.all([api.get<Shift[]>('/api/workforce/shifts'), api.get<Pattern[]>('/api/workforce/patterns')]);
  } catch (e) {
    notify(errorText(e), 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const ar = computed(() => locale.value.startsWith('ar'));
const nameOf = (x: { nameAr: string; nameEn: string }) => (ar.value ? x.nameAr : x.nameEn);
const shiftById = computed(() => new Map(shifts.value.map((s) => [s.id, s])));
const span = (s: { startTime: string; endTime: string }) => {
  const m = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const a = m(s.startTime);
  const b = m(s.endTime);
  return b > a ? b - a : 1440 - a + b;
};
const overnight = (s: Shift) => s.endTime <= s.startTime;
const hours = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const WEEKDAYS = computed(() => [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(Date.UTC(2026, 10, 1 + i)).toLocaleDateString(ar.value ? 'ar-SA' : 'en-GB', { weekday: 'short', timeZone: 'UTC' })));

// ─────────────────────────────────────────────── shift dialog
const shiftDialog = ref(false);
const shiftDraft = ref<Omit<Shift, 'id' | 'active'> & { id: string | null; active: boolean }>(blankShift());
function blankShift() {
  return { id: null as string | null, code: '', nameAr: '', nameEn: '', kind: 'FIXED' as const, startTime: '08:00', endTime: '16:00', breakMinutes: 60, graceMinutes: 15, requiredMinutes: null as number | null, color: '#5b3fd1', active: true };
}
const shiftForm = useForm();
function openShift(s?: Shift) {
  shiftDraft.value = s ? { ...s } : blankShift();
  shiftForm.reset();
  shiftDialog.value = true;
}
function saveShift() {
  return shiftForm.submit(async () => {
    const d = shiftDraft.value;
    const body = {
      code: d.code.trim(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), kind: d.kind,
      startTime: d.startTime, endTime: d.endTime, breakMinutes: Number(d.breakMinutes) || 0, graceMinutes: Number(d.graceMinutes) || 0,
      requiredMinutes: d.kind === 'FLEXIBLE' ? Number(d.requiredMinutes) || null : null, color: d.color || null, active: d.active,
    };
    if (d.id) await api.put(`/api/workforce/shifts/${d.id}`, body);
    else await api.post('/api/workforce/shifts', body);
    shiftDialog.value = false;
    notify(t('common.saved'));
    await load();
  });
}
async function removeShift(s: Shift) {
  if (!(await confirm({ title: t('shifts.deleteShift'), message: t('shifts.deleteShiftConfirm', { name: nameOf(s) }), color: 'error', confirmText: t('common.delete') }))) return;
  try {
    await api.delete(`/api/workforce/shifts/${s.id}`);
    await load();
  } catch (e) {
    notify(errorText(e), 'error');
  }
}

// ─────────────────────────────────────────────── pattern dialog
const patternDialog = ref(false);
const patternDraft = ref({ id: null as string | null, code: '', nameAr: '', nameEn: '', kind: 'WEEKLY' as 'WEEKLY' | 'ROTATION', cycleDays: 7, days: [] as string[][], active: true });
const patternForm = useForm();
function openPattern(p?: Pattern) {
  patternDraft.value = p
    ? { id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, kind: p.kind, cycleDays: p.cycleDays, days: p.days.map((d) => [...d]), active: p.active }
    : { id: null, code: '', nameAr: '', nameEn: '', kind: 'WEEKLY', cycleDays: 7, days: Array.from({ length: 7 }, () => []), active: true };
  patternForm.reset();
  patternDialog.value = true;
}
/** Keep the day list as long as the cycle when the kind or length changes. */
function resizeDays() {
  const d = patternDraft.value;
  const n = d.kind === 'WEEKLY' ? 7 : Math.min(56, Math.max(2, Number(d.cycleDays) || 2));
  d.cycleDays = n;
  d.days = Array.from({ length: n }, (_v, i) => d.days[i] ?? []);
}
const dayLabel = (i: number) => (patternDraft.value.kind === 'WEEKLY' ? WEEKDAYS.value[i] : t('shifts.dayN', { n: i + 1 }));
const activeShiftItems = computed(() => shifts.value.filter((s) => s.active).map((s) => ({ title: `${s.code} · ${s.startTime}–${s.endTime}`, value: s.id })));
function savePattern() {
  return patternForm.submit(async () => {
    const d = patternDraft.value;
    const body = { code: d.code.trim(), nameAr: d.nameAr.trim(), nameEn: d.nameEn.trim(), kind: d.kind, cycleDays: d.cycleDays, days: d.days, active: d.active };
    if (d.id) await api.put(`/api/workforce/patterns/${d.id}`, body);
    else await api.post('/api/workforce/patterns', body);
    patternDialog.value = false;
    notify(t('common.saved'));
    await load();
  });
}
async function removePattern(p: Pattern) {
  if (!(await confirm({ title: t('shifts.deletePattern'), message: t('shifts.deletePatternConfirm', { name: nameOf(p) }), color: 'error', confirmText: t('common.delete') }))) return;
  try {
    await api.delete(`/api/workforce/patterns/${p.id}`);
    await load();
  } catch (e) {
    notify(errorText(e), 'error');
  }
}
const weeklyMinutes = (p: Pattern) => {
  const total = p.days.flat().reduce((n, id) => {
    const s = shiftById.value.get(id);
    return s ? n + span(s) - s.breakMinutes : n;
  }, 0);
  return Math.round((total / p.cycleDays) * 7);
};
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('shifts.title')" :subtitle="$t('shifts.subtitle', { company: companyName })">
      <template v-if="canEdit">
        <v-btn v-if="tab === 'shifts'" color="primary" prepend-icon="plus" @click="openShift()">{{ $t('shifts.newShift') }}</v-btn>
        <v-btn v-else color="primary" prepend-icon="plus" :disabled="!shifts.some((s) => s.active)" @click="openPattern()">{{ $t('shifts.newPattern') }}</v-btn>
      </template>
    </PageHeader>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="shifts">{{ $t('shifts.shiftsTab') }}</v-tab>
      <v-tab value="patterns">{{ $t('shifts.patternsTab') }}</v-tab>
    </v-tabs>

    <v-card v-if="tab === 'shifts'">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-else-if="shifts.length === 0" icon="clock" :title="$t('shifts.noShifts')" :hint="$t('shifts.noShiftsHint')" />
      <v-table v-else density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('shifts.shift') }}</th>
            <th>{{ $t('shifts.hours') }}</th>
            <th>{{ $t('shifts.breakCol') }}</th>
            <th>{{ $t('shifts.graceCol') }}</th>
            <th style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in shifts" :key="s.id" :class="{ 'text-disabled': !s.active }">
            <td>
              <div class="d-flex align-center ga-2">
                <span class="swatch" :style="{ background: s.color ?? 'rgb(var(--v-theme-primary))' }" />
                <div>
                  <div class="text-body-2 font-weight-semibold">{{ nameOf(s) }}</div>
                  <div class="text-caption text-medium-emphasis">{{ s.code }} · {{ $t(`shifts.kinds.${s.kind}`) }}</div>
                </div>
              </div>
            </td>
            <td class="tnum" dir="ltr">
              {{ s.startTime }} – {{ s.endTime }}
              <v-chip v-if="overnight(s)" size="x-small" variant="tonal" color="info" class="ms-1">{{ $t('shifts.overnight') }}</v-chip>
              <div class="text-caption text-medium-emphasis">{{ s.kind === 'FLEXIBLE' && s.requiredMinutes ? $t('shifts.requiredShort', { h: hours(s.requiredMinutes) }) : $t('shifts.workTime', { h: hours(span(s) - s.breakMinutes) }) }}</div>
            </td>
            <td class="tnum">{{ s.breakMinutes }} {{ $t('shifts.min') }}</td>
            <td class="tnum">{{ s.graceMinutes }} {{ $t('shifts.min') }}</td>
            <td class="text-end">
              <template v-if="canEdit">
                <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openShift(s)" />
                <v-btn icon="trash-2" variant="text" size="small" :aria-label="$t('common.delete')" @click="removeShift(s)" />
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card v-else>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-else-if="patterns.length === 0" icon="calendar" :title="$t('shifts.noPatterns')" :hint="$t('shifts.noPatternsHint')" />
      <v-table v-else density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('shifts.pattern') }}</th>
            <th>{{ $t('shifts.cycle') }}</th>
            <th>{{ $t('shifts.perWeek') }}</th>
            <th class="text-end">{{ $t('shifts.people') }}</th>
            <th style="width: 110px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in patterns" :key="p.id" :class="{ 'text-disabled': !p.active }">
            <td>
              <div class="text-body-2 font-weight-semibold">{{ nameOf(p) }}</div>
              <div class="d-flex flex-wrap ga-1 mt-1">
                <span v-for="(d, i) in p.days" :key="i" class="daychip" :title="p.kind === 'WEEKLY' ? WEEKDAYS[i] : $t('shifts.dayN', { n: i + 1 })">
                  {{ d.length ? d.map((id) => shiftById.get(id)?.code ?? '?').join('+') : '·' }}
                </span>
              </div>
            </td>
            <td>{{ p.kind === 'WEEKLY' ? $t('shifts.weekly') : $t('shifts.rotationOf', { n: p.cycleDays }) }}</td>
            <td class="tnum">{{ hours(weeklyMinutes(p)) }}</td>
            <td class="text-end tnum">{{ p._count.assignments }}</td>
            <td class="text-end">
              <template v-if="canEdit">
                <v-btn icon="pencil" variant="text" size="small" :aria-label="$t('common.edit')" @click="openPattern(p)" />
                <v-btn icon="trash-2" variant="text" size="small" :aria-label="$t('common.delete')" @click="removePattern(p)" />
              </template>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <!-- shift dialog -->
    <v-dialog v-model="shiftDialog" max-width="560">
      <v-card :title="shiftDraft.id ? $t('shifts.editShift') : $t('shifts.newShift')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="shiftForm" />
          <v-form :ref="shiftForm.bind" @submit.prevent="saveShift">
            <v-row dense>
              <v-col cols="12" sm="4"><v-text-field v-model="shiftDraft.code" :label="$t('shifts.code') + ' *'" dir="ltr" :rules="[rules.required, rules.unitCode]" :error-messages="shiftForm.errorsFor('code')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="shiftDraft.nameAr" :label="$t('org.nameAr') + ' *'" dir="rtl" :rules="[rules.required]" :error-messages="shiftForm.errorsFor('nameAr')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="shiftDraft.nameEn" :label="$t('org.nameEn') + ' *'" dir="ltr" :rules="[rules.required]" :error-messages="shiftForm.errorsFor('nameEn')" /></v-col>
              <v-col cols="12">
                <v-btn-toggle v-model="shiftDraft.kind" mandatory color="primary" variant="outlined" density="comfortable">
                  <v-btn value="FIXED">{{ $t('shifts.kinds.FIXED') }}</v-btn>
                  <v-btn value="FLEXIBLE">{{ $t('shifts.kinds.FLEXIBLE') }}</v-btn>
                </v-btn-toggle>
                <p class="text-caption text-medium-emphasis mt-1 mb-2">{{ shiftDraft.kind === 'FIXED' ? $t('shifts.fixedHint') : $t('shifts.flexibleHint') }}</p>
              </v-col>
              <v-col cols="6"><v-text-field v-model="shiftDraft.startTime" type="time" :label="(shiftDraft.kind === 'FIXED' ? $t('shifts.start') : $t('shifts.windowStart')) + ' *'" :rules="[rules.required]" :error-messages="shiftForm.errorsFor('startTime')" /></v-col>
              <v-col cols="6"><v-text-field v-model="shiftDraft.endTime" type="time" :label="(shiftDraft.kind === 'FIXED' ? $t('shifts.end') : $t('shifts.windowEnd')) + ' *'" :rules="[rules.required]" :error-messages="shiftForm.errorsFor('endTime')" :hint="shiftDraft.endTime && shiftDraft.endTime <= shiftDraft.startTime ? $t('shifts.overnightHint') : ''" persistent-hint /></v-col>
              <v-col v-if="shiftDraft.kind === 'FLEXIBLE'" cols="12" sm="4"><v-text-field v-model.number="shiftDraft.requiredMinutes" type="number" :label="$t('shifts.requiredMinutes') + ' *'" :rules="[rules.required, rules.integer(1)]" :error-messages="shiftForm.errorsFor('requiredMinutes')" /></v-col>
              <v-col cols="6" sm="4"><v-text-field v-model.number="shiftDraft.breakMinutes" type="number" :label="$t('shifts.breakMinutes')" :rules="[rules.integer(0)]" :error-messages="shiftForm.errorsFor('breakMinutes')" /></v-col>
              <v-col cols="6" sm="4"><v-text-field v-model.number="shiftDraft.graceMinutes" type="number" :label="$t('shifts.graceMinutes')" :rules="[rules.integer(0)]" :error-messages="shiftForm.errorsFor('graceMinutes')" /></v-col>
              <v-col cols="6" sm="4"><v-text-field v-model="shiftDraft.color" type="color" :label="$t('shifts.color')" /></v-col>
              <v-col v-if="shiftDraft.id" cols="6" sm="4"><v-switch v-model="shiftDraft.active" color="success" :label="$t('company.active')" hide-details /></v-col>
            </v-row>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="shiftDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="shiftForm.busy.value" @click="saveShift">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- pattern dialog -->
    <v-dialog v-model="patternDialog" max-width="720" scrollable>
      <v-card :title="patternDraft.id ? $t('shifts.editPattern') : $t('shifts.newPattern')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="patternForm" />
          <v-form :ref="patternForm.bind" @submit.prevent="savePattern">
            <v-row dense>
              <v-col cols="12" sm="4"><v-text-field v-model="patternDraft.code" :label="$t('shifts.code') + ' *'" dir="ltr" :rules="[rules.required, rules.unitCode]" :error-messages="patternForm.errorsFor('code')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="patternDraft.nameAr" :label="$t('org.nameAr') + ' *'" dir="rtl" :rules="[rules.required]" :error-messages="patternForm.errorsFor('nameAr')" /></v-col>
              <v-col cols="12" sm="4"><v-text-field v-model="patternDraft.nameEn" :label="$t('org.nameEn') + ' *'" dir="ltr" :rules="[rules.required]" :error-messages="patternForm.errorsFor('nameEn')" /></v-col>
              <v-col cols="12" sm="8">
                <v-btn-toggle v-model="patternDraft.kind" mandatory color="primary" variant="outlined" density="comfortable" @update:model-value="resizeDays">
                  <v-btn value="WEEKLY">{{ $t('shifts.weekly') }}</v-btn>
                  <v-btn value="ROTATION">{{ $t('shifts.rotation') }}</v-btn>
                </v-btn-toggle>
                <p class="text-caption text-medium-emphasis mt-1 mb-0">{{ patternDraft.kind === 'WEEKLY' ? $t('shifts.weeklyHint') : $t('shifts.rotationHint') }}</p>
              </v-col>
              <v-col v-if="patternDraft.kind === 'ROTATION'" cols="12" sm="4">
                <v-text-field v-model.number="patternDraft.cycleDays" type="number" :label="$t('shifts.cycleDays') + ' *'" :rules="[rules.required, rules.integer(2)]" :error-messages="patternForm.errorsFor('cycleDays')" @blur="resizeDays" />
              </v-col>
            </v-row>
            <v-alert v-if="patternForm.errorsFor('days').length" type="error" variant="tonal" density="compact" class="mb-2">{{ patternForm.errorsFor('days').join(' ') }}</v-alert>
            <div class="days">
              <div v-for="(d, i) in patternDraft.days" :key="i" class="days__row">
                <span class="days__label">{{ dayLabel(i) }}</span>
                <v-autocomplete
                  v-model="patternDraft.days[i]"
                  :items="activeShiftItems"
                  :placeholder="$t('shifts.restDay')"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  hide-details
                />
              </div>
            </div>
            <v-switch v-if="patternDraft.id" v-model="patternDraft.active" color="success" :label="$t('company.active')" hide-details class="mt-2" />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="patternDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="patternForm.busy.value" @click="savePattern">{{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color">{{ snackbar.text }}</v-snackbar>
  </v-container>
</template>

<style scoped>
.swatch { width: 12px; height: 12px; border-radius: 4px; flex: none; }
.daychip { font: 500 11px/1 var(--v-font-family, inherit); padding: 4px 6px; border-radius: 6px; background: rgba(var(--v-theme-primary), 0.1); color: rgb(var(--v-theme-primary)); min-width: 22px; text-align: center; }
.days { display: grid; gap: 8px; }
.days__row { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 12px; }
.days__label { font-size: 13px; font-weight: 600; }
</style>
