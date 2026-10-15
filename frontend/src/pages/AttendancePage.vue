<script setup lang="ts">
/**
 * Attendance across the company: every judged day, filterable by period,
 * branch, status and review state. HR reviews the exceptions here — an
 * absence, lateness or early leave is only ever deducted after someone
 * CONFIRMS it; EXCUSE waives it. Branch managers see their branches only.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';
import FormErrorAlert from '../components/FormErrorAlert.vue';
import { useActiveCompanyName } from '../composables/useActiveCompany';
import { useOrgOptions } from '../composables/useOrgOptions';
import { useForm } from '../composables/useForm';
import { useAuthStore } from '../stores/auth';
import { errorText } from '../validation/errors';
import { REVIEW_COLOR, STATUS_COLOR, useAttendanceFormat, ymd, type AttendanceDayRow } from '../composables/useAttendanceFormat';

interface Row extends AttendanceDayRow {
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; orgUnit: { nameAr: string; nameEn: string } | null };
}

const { t } = useI18n();
const auth = useAuthStore();
const companyName = useActiveCompanyName();
const org = useOrgOptions();
const f = useAttendanceFormat();
const canReview = computed(() => auth.can('attendance.manage'));

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const from = ref(daysAgo(7));
const to = ref(daysAgo(0));
const unit = ref<string | null>(null);
const status = ref<string | null>(null);
const review = ref<string | null>(canReview.value ? 'PENDING' : null);
const q = ref('');
const page = ref(1);
const itemsPerPage = ref(50);
const rows = ref<Row[]>([]);
const total = ref(0);
const tz = ref('Asia/Riyadh');
const loading = ref(false);
const error = ref('');
const selected = ref<string[]>([]);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ from: from.value, to: to.value, page: String(page.value), limit: String(itemsPerPage.value) });
    if (unit.value) params.set('orgUnitId', unit.value);
    if (status.value) params.set('status', status.value);
    if (review.value) params.set('review', review.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<{ items: Row[]; total: number; timezone: string }>(`/api/attendance/days?${params}`);
    rows.value = data.items;
    total.value = data.total;
    tz.value = data.timezone;
    selected.value = selected.value.filter((id) => data.items.some((r) => r.id === id));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => void org.load());
let timer: ReturnType<typeof setTimeout> | undefined;
watch(q, () => {
  clearTimeout(timer);
  timer = setTimeout(() => ((page.value = 1), void load()), 300);
});
watch([from, to, unit, status, review], () => ((page.value = 1), void load()));

const STATUSES = ['PRESENT', 'ABSENT', 'INCOMPLETE', 'LATE', 'EARLY', 'OVERTIME', 'REST', 'HOLIDAY', 'UNSCHEDULED'];
const REVIEWS = ['PENDING', 'CONFIRMED', 'EXCUSED', 'NONE'];
const headers = computed(() => [
  { title: t('fields.name'), key: 'employee', sortable: false },
  { title: t('attendance.date'), key: 'date', sortable: false },
  { title: t('attendance.shift'), key: 'shiftCodes', sortable: false },
  { title: t('attendance.in'), key: 'firstIn', sortable: false },
  { title: t('attendance.out'), key: 'lastOut', sortable: false },
  { title: t('attendance.workedCol'), key: 'workedMinutes', sortable: false },
  { title: t('attendance.lateEarly'), key: 'late', sortable: false },
  { title: t('attendance.overtime'), key: 'overtimeMinutes', sortable: false },
  { title: t('attendance.status'), key: 'status', sortable: false },
]);
const reviewable = (r: Row) => canReview.value && r.review !== 'NONE' && !r.locked;

// ─────────────────────────────────────── review
const dialog = ref({ show: false, decision: 'CONFIRMED' as 'CONFIRMED' | 'EXCUSED', ids: [] as string[], note: '' });
const form = useForm();
function openReview(decision: 'CONFIRMED' | 'EXCUSED', ids: string[]) {
  form.reset();
  dialog.value = { show: true, decision, ids, note: '' };
}
function saveReview() {
  return form.submit(async () => {
    await api.post('/api/attendance/days/review', { ids: dialog.value.ids, decision: dialog.value.decision, ...(dialog.value.note.trim() ? { note: dialog.value.note.trim() } : {}) });
    dialog.value.show = false;
    selected.value = [];
    await load();
  });
}

// ─────────────────────────────────────── recompute
const recomputing = ref(false);
const notice = ref('');
async function recompute() {
  recomputing.value = true;
  error.value = '';
  try {
    const r = await api.post<{ count: number; people: number }>('/api/attendance/recompute', { from: from.value, to: to.value });
    notice.value = t('attendance.recomputed', { n: r.count, people: r.people });
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    recomputing.value = false;
  }
}
</script>

<template>
  <v-container class="py-8" fluid style="max-width: 1500px">
    <PageHeader :title="$t('attendance.registerTitle')" :subtitle="$t('attendance.registerSubtitle', { company: companyName })">
      <v-btn v-if="canReview" variant="tonal" prepend-icon="refresh-cw" :loading="recomputing" @click="recompute">{{ $t('attendance.recompute') }}</v-btn>
    </PageHeader>

    <div class="d-flex flex-wrap ga-3 mb-4">
      <v-text-field v-model="from" type="date" :label="$t('schedule.from')" density="compact" hide-details style="max-width: 170px" />
      <v-text-field v-model="to" type="date" :label="$t('schedule.to')" density="compact" hide-details style="max-width: 170px" />
      <v-select v-model="unit" :items="org.unitItems.value" :label="$t('fields.orgUnit')" density="compact" hide-details clearable style="max-width: 240px" />
      <v-select v-model="status" :items="STATUSES.map((s) => ({ title: $t(`attendance.statuses.${s}`), value: s }))" :label="$t('attendance.status')" density="compact" hide-details clearable style="max-width: 190px" />
      <v-select v-model="review" :items="REVIEWS.map((s) => ({ title: $t(`attendance.reviews.${s}`), value: s }))" :label="$t('attendance.review')" density="compact" hide-details clearable style="max-width: 190px" />
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable style="max-width: 220px" />
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" density="compact" closable class="mb-4" @click:close="notice = ''">{{ notice }}</v-alert>

    <v-slide-y-transition>
      <v-card v-if="selected.length" variant="tonal" color="primary" class="mb-3">
        <v-card-text class="d-flex flex-wrap align-center ga-2 py-2">
          <span class="text-body-2 font-weight-medium flex-grow-1">{{ $t('attendance.selectedN', { n: selected.length }) }}</span>
          <v-btn size="small" color="error" variant="flat" @click="openReview('CONFIRMED', selected)">{{ $t('attendance.confirm') }}</v-btn>
          <v-btn size="small" color="success" variant="flat" @click="openReview('EXCUSED', selected)">{{ $t('attendance.excuse') }}</v-btn>
        </v-card-text>
      </v-card>
    </v-slide-y-transition>

    <v-card>
      <v-data-table-server
        v-model="selected"
        v-model:page="page"
        v-model:items-per-page="itemsPerPage"
        :headers="headers"
        :items="rows"
        :items-length="total"
        :loading="loading"
        item-value="id"
        :show-select="canReview"
        :item-selectable="reviewable"
        density="comfortable"
        @update:options="load"
      >
        <template #item.employee="{ item }">
          <router-link :to="`/employees/${item.employee.id}?tab=attendance`" class="text-decoration-none">{{ item.employee.firstName }} {{ item.employee.lastName }}</router-link>
          <div class="text-caption text-medium-emphasis">{{ item.employee.orgUnit ? (f.ar.value ? item.employee.orgUnit.nameAr : item.employee.orgUnit.nameEn) : item.employee.employeeNo }}</div>
        </template>
        <template #item.date="{ item }"><span class="text-no-wrap">{{ f.day(item.date) }}</span></template>
        <template #item.shiftCodes="{ item }">{{ item.shiftCodes ?? '—' }}</template>
        <template #item.firstIn="{ item }"><span dir="ltr">{{ f.time(item.firstIn, tz) }}</span></template>
        <template #item.lastOut="{ item }"><span dir="ltr">{{ f.time(item.lastOut, tz) }}</span></template>
        <template #item.workedMinutes="{ item }"><span dir="ltr">{{ f.minutes(item.workedMinutes) }}</span></template>
        <template #item.late="{ item }">
          <span v-if="item.lateMinutes" class="text-warning text-no-wrap">{{ $t('attendance.lateN', { n: item.lateMinutes }) }}</span>
          <span v-if="item.lateMinutes && item.earlyLeaveMinutes"> · </span>
          <span v-if="item.earlyLeaveMinutes" class="text-warning text-no-wrap">{{ $t('attendance.earlyN', { n: item.earlyLeaveMinutes }) }}</span>
          <span v-if="!item.lateMinutes && !item.earlyLeaveMinutes" class="text-medium-emphasis">—</span>
        </template>
        <template #item.overtimeMinutes="{ item }"><span dir="ltr">{{ f.minutes(item.overtimeMinutes) }}</span></template>
        <template #item.status="{ item }">
          <div class="d-flex align-center flex-wrap ga-1 py-1">
            <v-chip size="x-small" variant="tonal" :color="STATUS_COLOR[item.status]">{{ $t(`attendance.statuses.${item.status}`) }}</v-chip>
            <v-chip v-if="item.review !== 'NONE'" size="x-small" variant="tonal" :color="REVIEW_COLOR[item.review]">
              {{ $t(`attendance.reviews.${item.review}`) }}
              <v-tooltip v-if="item.reviewedBy" activator="parent" location="top">{{ $t('attendance.reviewedBy', { name: item.reviewedBy, at: f.stamp(item.reviewedAt) }) }}<template v-if="item.reviewNote"> — {{ item.reviewNote }}</template></v-tooltip>
            </v-chip>
            <template v-if="reviewable(item) && item.review === 'PENDING'">
              <v-btn size="x-small" variant="text" color="error" @click="openReview('CONFIRMED', [item.id])">{{ $t('attendance.confirm') }}</v-btn>
              <v-btn size="x-small" variant="text" color="success" @click="openReview('EXCUSED', [item.id])">{{ $t('attendance.excuse') }}</v-btn>
            </template>
          </div>
        </template>
        <template #no-data>
          <EmptyState icon="calendar-check" :title="$t('attendance.registerEmpty')" compact />
        </template>
      </v-data-table-server>
    </v-card>

    <v-dialog v-model="dialog.show" max-width="460">
      <v-card :title="dialog.decision === 'CONFIRMED' ? $t('attendance.confirmTitle', { n: dialog.ids.length }) : $t('attendance.excuseTitle', { n: dialog.ids.length })" class="pa-2">
        <v-card-text>
          <FormErrorAlert :form="form" />
          <p class="text-body-2 text-medium-emphasis mb-3">{{ dialog.decision === 'CONFIRMED' ? $t('attendance.confirmHint') : $t('attendance.excuseHint') }}</p>
          <v-textarea v-model="dialog.note" :label="$t('attendance.note')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn :color="dialog.decision === 'CONFIRMED' ? 'error' : 'success'" variant="flat" :loading="form.busy.value" @click="saveReview">
            {{ dialog.decision === 'CONFIRMED' ? $t('attendance.confirm') : $t('attendance.excuse') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
