<script setup lang="ts">
/**
 * Workforce and payroll reports of the selected company: the attendance of a
 * period, leave balances of a year, and per payroll month the register, the
 * comparison with the month before and the bank transfer list. Each tab shows
 * only for people allowed to see it; a branch manager sees their branches.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useOrgOptions } from '../composables/useOrgOptions';
import { downloadFile } from '../composables/useDownload';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';
import { ymd } from '../composables/useAttendanceFormat';

interface Emp { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null }
interface AttRow { employee: Emp; workingDays: number; present: number; absent: number; missingPunch: number; leave: number; lateDays: number; lateMinutes: number; earlyMinutes: number; overtimeRecorded: number; overtimeApproved: number; toReview: number }
interface LeaveData { year: number; types: Array<{ id: string; code: string; nameAr: string; nameEn: string; balanceMode: string }>; rows: Array<{ employee: Emp; types: Array<{ code: string; balance: number | null; taken: number; pending: number }> }> }
interface VarRow { employee: Emp; previousNet: number | null; net: number | null; difference: number | null; percent: number | null; status: 'BOTH' | 'NEW' | 'MISSING'; changed: string[] }
interface Variance { month: string; previousMonth: string | null; totals: { net: number; previousNet: number | null; employees: number; previousEmployees: number | null }; rows: VarRow[] }
interface Run { id: string; month: string; status: string }

const { t, locale } = useI18n();
const auth = useAuthStore();
const companyName = useActiveCompanyName();
const org = useOrgOptions();
const ar = computed(() => locale.value.startsWith('ar'));
const nameOf = (e: Emp) => `${e.firstName} ${e.lastName}`;
const unitOf = (e: Emp) => (e.orgUnit ? (ar.value ? e.orgUnit.nameAr : e.orgUnit.nameEn) : '');
const hours = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '—');
const money = (n: number | null) => (n == null ? '—' : n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

const can = {
  attendance: computed(() => auth.can('attendance.read', 'attendance.manage', 'attendance.approve')),
  leave: computed(() => auth.can('leave.read', 'leave.manage', 'leave.approve')),
  payroll: computed(() => auth.can('payroll.prepare', 'payroll.approve', 'compensation.read')),
};
const tab = ref(can.attendance.value ? 'attendance' : can.leave.value ? 'leave' : 'payroll');
const error = ref('');
const busy = ref('');
async function excel(url: string, name: string, key: string) {
  busy.value = key;
  error.value = '';
  try {
    await downloadFile(url, name);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = '';
  }
}

// ─────────────────────────────────────── attendance
const now = new Date();
const att = ref({ from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now), unit: null as string | null, rows: [] as AttRow[], loading: false });
const attQuery = computed(() => {
  const p = new URLSearchParams({ from: att.value.from, to: att.value.to });
  if (att.value.unit) p.set('orgUnitId', att.value.unit);
  return p.toString();
});
async function loadAttendance() {
  if (!can.attendance.value) return;
  att.value.loading = true;
  error.value = '';
  try {
    att.value.rows = (await api.get<{ rows: AttRow[] }>(`/api/hr-reports/attendance?${attQuery.value}`)).rows;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    att.value.loading = false;
  }
}
watch(() => [att.value.from, att.value.to, att.value.unit], () => void loadAttendance());

// ─────────────────────────────────────── leave
const leave = ref({ year: now.getFullYear(), unit: null as string | null, data: null as LeaveData | null, loading: false });
const leaveQuery = computed(() => {
  const p = new URLSearchParams({ year: String(leave.value.year) });
  if (leave.value.unit) p.set('orgUnitId', leave.value.unit);
  return p.toString();
});
async function loadLeave() {
  if (!can.leave.value) return;
  leave.value.loading = true;
  try {
    leave.value.data = await api.get<LeaveData>(`/api/hr-reports/leave?${leaveQuery.value}`);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    leave.value.loading = false;
  }
}
watch(() => [leave.value.year, leave.value.unit], () => void loadLeave());
const accruing = computed(() => (leave.value.data?.types ?? []).filter((x) => x.balanceMode === 'ACCRUAL'));
const takenTypes = computed(() => (leave.value.data?.types ?? []).filter((x) => x.balanceMode !== 'ACCRUAL' && leave.value.data!.rows.some((r) => r.types.find((y) => y.code === x.code)!.taken > 0)));
const cell = (row: LeaveData['rows'][number], code: string) => row.types.find((x) => x.code === code)!;

// ─────────────────────────────────────── payroll
const runs = ref<Run[]>([]);
const runId = ref<string | null>(null);
const variance = ref<Variance | null>(null);
const run = computed(() => runs.value.find((r) => r.id === runId.value) ?? null);
async function loadRuns() {
  if (!auth.can('payroll.prepare', 'payroll.approve')) return;
  try {
    runs.value = (await api.get<Run[]>('/api/payroll/runs')).filter((r) => r.status !== 'CANCELLED');
    runId.value = runs.value[0]?.id ?? null;
  } catch (e) {
    error.value = errorText(e);
  }
}
watch(runId, async (id) => {
  variance.value = null;
  if (!id) return;
  try {
    variance.value = await api.get<Variance>(`/api/hr-reports/payroll/${id}/variance`);
  } catch (e) {
    error.value = errorText(e);
  }
});

onMounted(() => {
  void org.load();
  void loadAttendance();
  void loadLeave();
  void loadRuns();
});
const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);
</script>

<template>
  <v-container class="py-8" fluid style="max-width: 1400px">
    <PageHeader :title="$t('hrReports.title')" :subtitle="$t('hrReports.subtitle', { company: companyName })" />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab v-if="can.attendance.value" value="attendance" prepend-icon="clock">{{ $t('hrReports.attendance') }}</v-tab>
      <v-tab v-if="can.leave.value" value="leave" prepend-icon="calendar-check">{{ $t('hrReports.leave') }}</v-tab>
      <v-tab v-if="can.payroll.value" value="payroll" prepend-icon="banknote">{{ $t('hrReports.payroll') }}</v-tab>
    </v-tabs>

    <v-window v-model="tab" :touch="false">
      <!-- Attendance -->
      <v-window-item value="attendance">
        <div class="d-flex flex-wrap align-center ga-3 mb-3">
          <v-text-field v-model="att.from" type="date" :label="$t('schedule.from')" density="compact" hide-details style="max-width: 170px" />
          <v-text-field v-model="att.to" type="date" :label="$t('schedule.to')" density="compact" hide-details style="max-width: 170px" />
          <v-select v-model="att.unit" :items="org.unitItems.value" :label="$t('fields.orgUnit')" density="compact" hide-details clearable style="max-width: 240px" />
          <v-spacer />
          <v-btn variant="tonal" prepend-icon="file-spreadsheet" :loading="busy === 'att'" @click="excel(`/api/hr-reports/attendance.xlsx?${attQuery}`, `attendance-${att.from}-${att.to}.xlsx`, 'att')">Excel</v-btn>
        </div>
        <v-card>
          <v-progress-linear v-if="att.loading" indeterminate color="primary" />
          <EmptyState v-if="!att.loading && att.rows.length === 0" icon="clock" :title="$t('hrReports.empty')" compact />
          <v-table v-else density="compact" class="rep">
            <thead>
              <tr>
                <th>{{ $t('fields.name') }}</th>
                <th class="text-end">{{ $t('hrReports.workingDays') }}</th>
                <th class="text-end">{{ $t('attendance.statuses.PRESENT') }}</th>
                <th class="text-end">{{ $t('attendance.statuses.ABSENT') }}</th>
                <th class="text-end">{{ $t('attendance.statuses.INCOMPLETE') }}</th>
                <th class="text-end">{{ $t('attendance.statuses.LEAVE') }}</th>
                <th class="text-end">{{ $t('hrReports.lateDays') }}</th>
                <th class="text-end">{{ $t('hrReports.late') }}</th>
                <th class="text-end">{{ $t('hrReports.early') }}</th>
                <th class="text-end">{{ $t('hrReports.otRecorded') }}</th>
                <th class="text-end">{{ $t('hrReports.otApproved') }}</th>
                <th class="text-end">{{ $t('attendance.reviews.PENDING') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in att.rows" :key="r.employee.id">
                <td><router-link :to="`/employees/${r.employee.id}?tab=attendance`" class="text-decoration-none">{{ nameOf(r.employee) }}</router-link><div class="text-caption text-medium-emphasis">{{ unitOf(r.employee) }}</div></td>
                <td class="text-end">{{ r.workingDays }}</td>
                <td class="text-end">{{ r.present }}</td>
                <td class="text-end" :class="{ 'text-error': r.absent }">{{ r.absent }}</td>
                <td class="text-end" :class="{ 'text-warning': r.missingPunch }">{{ r.missingPunch }}</td>
                <td class="text-end">{{ r.leave }}</td>
                <td class="text-end">{{ r.lateDays }}</td>
                <td class="text-end" dir="ltr">{{ hours(r.lateMinutes) }}</td>
                <td class="text-end" dir="ltr">{{ hours(r.earlyMinutes) }}</td>
                <td class="text-end" dir="ltr">{{ hours(r.overtimeRecorded) }}</td>
                <td class="text-end" dir="ltr">{{ hours(r.overtimeApproved) }}</td>
                <td class="text-end" :class="{ 'text-warning': r.toReview }">{{ r.toReview }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <!-- Leave -->
      <v-window-item value="leave">
        <div class="d-flex flex-wrap align-center ga-3 mb-3">
          <v-select v-model="leave.year" :items="years" :label="$t('hrReports.year')" density="compact" hide-details style="max-width: 130px" />
          <v-select v-model="leave.unit" :items="org.unitItems.value" :label="$t('fields.orgUnit')" density="compact" hide-details clearable style="max-width: 240px" />
          <v-spacer />
          <v-btn variant="tonal" prepend-icon="file-spreadsheet" :loading="busy === 'leave'" @click="excel(`/api/hr-reports/leave.xlsx?${leaveQuery}`, `leave-${leave.year}.xlsx`, 'leave')">Excel</v-btn>
        </div>
        <v-card>
          <v-progress-linear v-if="leave.loading" indeterminate color="primary" />
          <EmptyState v-if="!leave.loading && !leave.data?.rows.length" icon="calendar-check" :title="$t('hrReports.empty')" compact />
          <v-table v-else-if="leave.data" density="compact" class="rep">
            <thead>
              <tr>
                <th>{{ $t('fields.name') }}</th>
                <template v-for="ty in accruing" :key="ty.id">
                  <th class="text-end">{{ ar ? ty.nameAr : ty.nameEn }} · {{ $t('hrReports.balance') }}</th>
                  <th class="text-end">{{ $t('hrReports.taken') }}</th>
                </template>
                <th v-for="ty in takenTypes" :key="ty.id" class="text-end">{{ ar ? ty.nameAr : ty.nameEn }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in leave.data.rows" :key="r.employee.id">
                <td><router-link :to="`/employees/${r.employee.id}?tab=leave`" class="text-decoration-none">{{ nameOf(r.employee) }}</router-link><div class="text-caption text-medium-emphasis">{{ unitOf(r.employee) }}</div></td>
                <template v-for="ty in accruing" :key="ty.id">
                  <td class="text-end font-weight-medium">{{ cell(r, ty.code).balance }}</td>
                  <td class="text-end">{{ cell(r, ty.code).taken || '—' }}<span v-if="cell(r, ty.code).pending" class="text-warning"> (+{{ cell(r, ty.code).pending }})</span></td>
                </template>
                <td v-for="ty in takenTypes" :key="ty.id" class="text-end">{{ cell(r, ty.code).taken || '—' }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-window-item>

      <!-- Payroll -->
      <v-window-item value="payroll">
        <EmptyState v-if="runs.length === 0" icon="banknote" :title="$t('payroll.empty')" compact />
        <template v-else>
          <div class="d-flex flex-wrap align-center ga-3 mb-3">
            <v-select v-model="runId" :items="runs.map((r) => ({ title: `${monthLabel(r.month)} — ${t(`payroll.statuses.${r.status}`)}`, value: r.id }))" :label="$t('payroll.month')" density="compact" hide-details style="max-width: 320px" />
            <v-spacer />
            <v-btn variant="tonal" prepend-icon="file-spreadsheet" :loading="busy === 'reg'" @click="excel(`/api/hr-reports/payroll/${runId}/register.xlsx`, `payroll-register-${run?.month}.xlsx`, 'reg')">{{ $t('hrReports.register') }}</v-btn>
            <v-btn variant="tonal" prepend-icon="file-spreadsheet" :loading="busy === 'var'" @click="excel(`/api/hr-reports/payroll/${runId}/variance.xlsx`, `payroll-variance-${run?.month}.xlsx`, 'var')">{{ $t('hrReports.variance') }}</v-btn>
            <v-btn v-if="auth.can('compensation.read') && run && (run.status === 'APPROVED' || run.status === 'PAID')" color="primary" variant="flat" prepend-icon="landmark" :loading="busy === 'bank'" @click="excel(`/api/hr-reports/payroll/${runId}/bank.xlsx`, `bank-transfers-${run?.month}.xlsx`, 'bank')">{{ $t('hrReports.bank') }}</v-btn>
          </div>
          <p v-if="auth.can('compensation.read')" class="text-caption text-medium-emphasis mb-3">{{ $t('hrReports.bankHint') }}</p>
          <v-card v-if="variance">
            <v-card-item>
              <v-card-title class="text-subtitle-1 font-weight-bold">{{ $t('hrReports.varianceTitle', { month: monthLabel(variance.month) }) }}</v-card-title>
              <v-card-subtitle v-if="variance.previousMonth">
                {{ $t('hrReports.varianceSub', { prev: monthLabel(variance.previousMonth), before: money(variance.totals.previousNet), now: money(variance.totals.net), pe: variance.totals.previousEmployees, ne: variance.totals.employees }) }}
              </v-card-subtitle>
              <v-card-subtitle v-else>{{ $t('hrReports.noPrevious') }}</v-card-subtitle>
            </v-card-item>
            <v-table density="compact" class="rep">
              <thead>
                <tr>
                  <th>{{ $t('fields.name') }}</th>
                  <th class="text-end">{{ variance.previousMonth ? monthLabel(variance.previousMonth) : '' }}</th>
                  <th class="text-end">{{ monthLabel(variance.month) }}</th>
                  <th class="text-end">{{ $t('hrReports.difference') }}</th>
                  <th>{{ $t('hrReports.changed') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in variance.rows" :key="r.employee.id">
                  <td>
                    {{ nameOf(r.employee) }}
                    <v-chip v-if="r.status !== 'BOTH'" size="x-small" variant="tonal" :color="r.status === 'NEW' ? 'info' : 'warning'" class="ms-1">{{ $t(`hrReports.statuses.${r.status}`) }}</v-chip>
                    <div class="text-caption text-medium-emphasis">{{ unitOf(r.employee) }}</div>
                  </td>
                  <td class="text-end" dir="ltr">{{ money(r.previousNet) }}</td>
                  <td class="text-end" dir="ltr">{{ money(r.net) }}</td>
                  <td class="text-end" dir="ltr" :class="r.difference ? (r.difference > 0 ? 'text-success' : 'text-error') : ''">
                    <template v-if="r.difference !== null">{{ r.difference > 0 ? '+' : '' }}{{ money(r.difference) }}<span v-if="r.percent !== null" class="text-caption"> ({{ r.percent }}%)</span></template>
                    <template v-else>—</template>
                  </td>
                  <td class="text-caption">{{ r.changed.join(', ') }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card>
        </template>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<style scoped>
.rep th, .rep td { white-space: nowrap; }
</style>
