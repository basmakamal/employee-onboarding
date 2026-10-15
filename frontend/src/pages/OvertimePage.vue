<script setup lang="ts">
/**
 * Overtime of the company (a branch manager: their branches), waiting
 * requests first by default. The approver sees each request next to what the
 * day itself recorded, approves all or part of the minutes, or rejects — the
 * decision always records who made it. Overtime is paid only once approved.
 */
import { computed, ref, watch } from 'vue';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useForm } from '../composables/useForm';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';
import { REQUEST_COLOR, STATUS_COLOR, useAttendanceFormat } from '../composables/useAttendanceFormat';

interface Req {
  id: string;
  date: string;
  status: string;
  reason: string;
  minutes: number;
  approvedMinutes: number | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
  day: { status: string; firstIn: string | null; lastOut: string | null; workedMinutes: number; overtimeMinutes: number; shiftCodes: string | null } | null;
}

const auth = useAuthStore();
const companyName = useActiveCompanyName();
const f = useAttendanceFormat();
const canDecide = computed(() => auth.can('attendance.approve'));

const status = ref<string | null>('PENDING');
const page = ref(1);
const rows = ref<Req[]>([]);
const total = ref(0);
const tz = ref('Asia/Riyadh');
const loading = ref(false);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), limit: '25' });
    if (status.value) params.set('status', status.value);
    const data = await api.get<{ items: Req[]; total: number; timezone: string }>(`/api/attendance/overtime?${params}`);
    rows.value = data.items;
    total.value = data.total;
    tz.value = data.timezone;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
watch(status, () => ((page.value = 1), void load()));
watch(page, () => void load());
void load();

// ─────────────────────────────────────── decide
const dialog = ref({ show: false, approve: true, row: null as Req | null, note: '', hours: 0, mins: 0 });
const form = useForm();
function openDecision(row: Req, approve: boolean) {
  form.reset();
  dialog.value = { show: true, approve, row, note: '', hours: Math.floor(row.minutes / 60), mins: row.minutes % 60 };
}
function saveDecision() {
  return form.submit(async () => {
    const d = dialog.value;
    if (!d.row) return;
    await api.post(`/api/attendance/overtime/${d.row.id}/decision`, {
      approve: d.approve,
      ...(d.approve ? { approvedMinutes: Number(d.hours) * 60 + Number(d.mins) } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
    d.show = false;
    await load();
  });
}
</script>

<template>
  <v-container class="py-8" style="max-width: 1100px">
    <PageHeader :title="$t('attendance.overtimePageTitle')" :subtitle="$t('attendance.overtimePageSubtitle', { company: companyName })" />

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-select
        v-model="status"
        :items="['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ title: $t(`attendance.requestStatuses.${s}`), value: s }))"
        :label="$t('attendance.status')"
        density="compact"
        hide-details
        clearable
        style="max-width: 220px"
      />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-card>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <EmptyState v-if="!loading && rows.length === 0" icon="check-check" :title="$t('attendance.overtimeEmpty')" compact />
      <div v-for="r in rows" :key="r.id" class="req pa-4">
        <div class="d-flex flex-wrap align-start ga-3">
          <div class="flex-grow-1 min-w-0">
            <div class="d-flex flex-wrap align-center ga-2">
              <router-link :to="`/employees/${r.employee.id}?tab=attendance`" class="text-body-1 font-weight-bold text-decoration-none">{{ r.employee.firstName }} {{ r.employee.lastName }}</router-link>
              <span class="text-caption text-medium-emphasis">{{ r.employee.orgUnit ? (f.ar.value ? r.employee.orgUnit.nameAr : r.employee.orgUnit.nameEn) : r.employee.employeeNo }}</span>
              <v-chip size="x-small" variant="tonal" :color="REQUEST_COLOR[r.status]">{{ $t(`attendance.requestStatuses.${r.status}`) }}</v-chip>
            </div>
            <div class="text-body-2 mt-1">
              <b>{{ f.day(r.date, true) }}</b> · {{ $t('attendance.askedFor') }} <b dir="ltr">{{ f.minutes(r.minutes) }}</b>
              <span v-if="r.status === 'APPROVED'"> · {{ $t('attendance.approvedN') }} <b dir="ltr">{{ f.minutes(r.approvedMinutes) }}</b></span>
            </div>
            <div class="text-body-2 text-medium-emphasis mt-1">“{{ r.reason }}”</div>
            <div class="text-caption text-medium-emphasis mt-1">{{ $t('attendance.enteredBy', { name: r.requestedBy ?? '—' }) }} · {{ f.stamp(r.createdAt) }}</div>
            <!-- What the day itself recorded -->
            <div class="evidence mt-2 text-caption">
              <template v-if="r.day">
                <v-chip size="x-small" variant="tonal" :color="STATUS_COLOR[r.day.status]" class="me-1">{{ $t(`attendance.statuses.${r.day.status}`) }}</v-chip>
                {{ $t('attendance.recorded') }}: {{ r.day.shiftCodes ?? '—' }} ·
                {{ $t('attendance.in') }} <span dir="ltr">{{ f.time(r.day.firstIn, tz) }}</span> ·
                {{ $t('attendance.out') }} <span dir="ltr">{{ f.time(r.day.lastOut, tz) }}</span> ·
                {{ $t('attendance.workedCol') }} <span dir="ltr">{{ f.minutes(r.day.workedMinutes) }}</span> ·
                {{ $t('attendance.overtime') }} <span dir="ltr">{{ f.minutes(r.day.overtimeMinutes) }}</span>
              </template>
              <template v-else>{{ $t('attendance.notJudgedYet') }}</template>
            </div>
            <div v-if="r.decidedBy" class="text-caption mt-2">
              {{ $t('attendance.decidedBy', { name: r.decidedBy, at: f.stamp(r.decidedAt) }) }}<template v-if="r.decisionNote"> — {{ r.decisionNote }}</template>
            </div>
          </div>
          <div v-if="canDecide && r.status === 'PENDING'" class="d-flex ga-2">
            <v-btn color="success" variant="flat" size="small" prepend-icon="check" @click="openDecision(r, true)">{{ $t('attendance.approve') }}</v-btn>
            <v-btn color="error" variant="tonal" size="small" prepend-icon="x" @click="openDecision(r, false)">{{ $t('attendance.reject') }}</v-btn>
          </div>
        </div>
      </div>
      <div v-if="total > 25" class="d-flex justify-center py-2">
        <v-pagination v-model="page" :length="Math.ceil(total / 25)" density="compact" />
      </div>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="460">
      <v-card :title="dialog.approve ? $t('attendance.approve') : $t('attendance.reject')" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <v-row v-if="dialog.approve" dense>
            <v-col cols="12"><p class="text-body-2 text-medium-emphasis mb-1">{{ $t('attendance.approveOvertimeHint') }}</p></v-col>
            <v-col cols="6"><v-text-field v-model.number="dialog.hours" type="number" min="0" max="12" :label="$t('attendance.hours')" /></v-col>
            <v-col cols="6"><v-text-field v-model.number="dialog.mins" type="number" min="0" max="59" step="5" :label="$t('attendance.minutes')" :error-messages="form.errorsFor('approvedMinutes')" /></v-col>
          </v-row>
          <v-textarea v-model="dialog.note" :label="$t('attendance.note')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn :color="dialog.approve ? 'success' : 'error'" variant="flat" :loading="form.busy.value" @click="saveDecision">
            {{ dialog.approve ? $t('attendance.approve') : $t('attendance.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.req + .req { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.evidence { background: rgba(var(--v-theme-on-surface), 0.04); border-radius: 8px; padding: 6px 10px; display: inline-block; }
</style>
