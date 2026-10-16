<script setup lang="ts">
/**
 * The payslips of an approved run: who has one, whether the e-mail went out
 * (and to which address), a download per person, and sending — to everyone
 * not sent yet, to one branch / department, or to one person (again, if
 * needed). Sending runs in the background; the list refreshes itself.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { useForm } from '../composables/useForm';
import { useOrgOptions } from '../composables/useOrgOptions';
import { downloadFile } from '../composables/useDownload';
import { errorText } from '../validation/errors';
import FormErrorAlert from './FormErrorAlert.vue';

interface Row {
  lineId: string;
  held: boolean;
  net: number;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string | null; email: string | null; orgUnit: { id: string; nameAr: string; nameEn: string } | null };
  payslip: { id: string; generatedAt: string } | null;
  delivery: { email: string | null; status: string; trigger: string; createdAt: string; sentAt: string | null } | null;
}

const props = defineProps<{ runId: string; month: string; canSend: boolean }>();
const { t, locale } = useI18n();
const org = useOrgOptions();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const STATUS_COLOR: Record<string, string> = { SENT: 'success', QUEUED: 'info', FAILED: 'error', NO_EMAIL: 'warning' };

const rows = ref<Row[]>([]);
const error = ref('');
const notice = ref('');
const q = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    rows.value = (await api.get<Row[]>(`/api/payroll/runs/${props.runId}/payslips`)).filter((r) => !r.held);
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(() => {
  void org.load();
  void load();
});
onBeforeUnmount(() => clearInterval(timer));
// While something is on its way, look again every few seconds.
watch(rows, (r) => {
  clearInterval(timer);
  if (r.some((x) => x.delivery?.status === 'QUEUED')) timer = setInterval(() => void load(), 4000);
});

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return rows.value.filter((r) => !needle || `${r.employee.firstName} ${r.employee.lastName} ${r.employee.employeeNo ?? ''}`.toLowerCase().includes(needle));
});
const counts = computed(() => ({
  sent: rows.value.filter((r) => r.delivery?.status === 'SENT').length,
  pending: rows.value.filter((r) => !r.delivery || r.delivery.status === 'FAILED').length,
  noEmail: rows.value.filter((r) => !r.employee.email).length,
}));

async function download(r: Row) {
  try {
    await downloadFile(`/api/payroll/runs/${props.runId}/lines/${r.lineId}/payslip.pdf`, `payslip-${props.month}-${r.employee.employeeNo ?? r.employee.id}.pdf`);
    if (!r.payslip) await load();
  } catch (e) {
    error.value = errorText(e);
  }
}

// ─────────────────────────────────────── send
const dialog = ref({ show: false, scope: 'ALL' as 'ALL' | 'UNIT' | 'EMPLOYEE', orgUnitId: null as string | null, employeeId: null as string | null, resend: false });
const form = useForm();
function openSend(scope: 'ALL' | 'UNIT' | 'EMPLOYEE', employeeId: string | null = null) {
  form.reset();
  const resend = scope === 'EMPLOYEE' && !!rows.value.find((r) => r.employee.id === employeeId)?.delivery;
  dialog.value = { show: true, scope, orgUnitId: null, employeeId, resend };
}
function send() {
  return form.submit(async () => {
    const d = dialog.value;
    const r = await api.post<{ count: number; skipped: number }>(`/api/payroll/runs/${props.runId}/payslips/send`, {
      scope: d.scope,
      ...(d.scope === 'UNIT' ? { orgUnitId: d.orgUnitId } : {}),
      ...(d.scope === 'EMPLOYEE' ? { employeeId: d.employeeId } : {}),
      resend: d.resend,
    });
    dialog.value.show = false;
    notice.value = t('payslips.sending', { n: r.count, skipped: r.skipped });
    setTimeout(() => void load(), 1200);
  });
}
const who = computed(() => {
  const r = rows.value.find((x) => x.employee.id === dialog.value.employeeId);
  return r ? `${r.employee.firstName} ${r.employee.lastName}` : '';
});
</script>

<template>
  <v-card class="mt-4">
    <div class="d-flex align-center flex-wrap ga-2 px-4 pt-4">
      <div class="flex-grow-1">
        <h3 class="text-subtitle-1 font-weight-bold mb-0">{{ $t('payslips.title') }}</h3>
        <p class="text-caption text-medium-emphasis mb-0">{{ $t('payslips.counts', counts) }}</p>
      </div>
      <template v-if="canSend">
        <v-btn color="primary" variant="flat" size="small" prepend-icon="send" @click="openSend('ALL')">{{ $t('payslips.sendAll') }}</v-btn>
        <v-btn variant="tonal" size="small" prepend-icon="network" @click="openSend('UNIT')">{{ $t('payslips.sendUnit') }}</v-btn>
      </template>
    </div>
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="notice" type="success" variant="tonal" density="compact" closable class="mb-3" @click:close="notice = ''">{{ notice }}</v-alert>
      <v-text-field v-model="q" :label="$t('common.search')" prepend-inner-icon="search" density="compact" hide-details clearable class="mb-2" style="max-width: 260px" />
      <v-table density="compact">
        <tbody>
          <tr v-for="r in filtered" :key="r.lineId">
            <td class="py-2">
              <div class="font-weight-medium">{{ r.employee.firstName }} {{ r.employee.lastName }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ r.employee.employeeNo ?? '' }}<template v-if="r.employee.orgUnit"> · {{ ar ? r.employee.orgUnit.nameAr : r.employee.orgUnit.nameEn }}</template>
              </div>
            </td>
            <td class="text-end" dir="ltr">{{ money(r.net) }}</td>
            <td>
              <v-chip v-if="r.delivery" size="x-small" variant="tonal" :color="STATUS_COLOR[r.delivery.status]">{{ $t(`payslips.statuses.${r.delivery.status}`) }}</v-chip>
              <v-chip v-else-if="!r.employee.email" size="x-small" variant="tonal" color="warning">{{ $t('payslips.statuses.NO_EMAIL') }}</v-chip>
              <span v-else class="text-caption text-medium-emphasis">{{ $t('payslips.notSent') }}</span>
              <div v-if="r.delivery" class="text-caption text-medium-emphasis">
                <span dir="ltr">{{ r.delivery.email ?? '' }}</span> · {{ stamp(r.delivery.sentAt ?? r.delivery.createdAt) }}<template v-if="r.delivery.trigger === 'SCHEDULED'"> · {{ $t('payslips.auto') }}</template>
              </div>
            </td>
            <td class="text-end text-no-wrap">
              <v-btn size="small" variant="text" prepend-icon="download" @click="download(r)">PDF</v-btn>
              <v-btn v-if="canSend && r.employee.email" size="small" variant="text" @click="openSend('EMPLOYEE', r.employee.id)">{{ r.delivery ? $t('payslips.resend') : $t('payslips.send') }}</v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <v-dialog v-model="dialog.show" max-width="460">
    <v-card :title="dialog.scope === 'ALL' ? $t('payslips.sendAll') : dialog.scope === 'UNIT' ? $t('payslips.sendUnit') : $t('payslips.sendOne', { name: who })" class="pa-2">
      <v-card-text>
        <FormErrorAlert :form="form" />
        <p class="text-body-2 text-medium-emphasis mb-3">{{ $t('payslips.sendHint') }}</p>
        <v-select v-if="dialog.scope === 'UNIT'" v-model="dialog.orgUnitId" :items="org.unitItems.value" :label="$t('fields.orgUnit') + ' *'" :error-messages="form.errorsFor('orgUnitId')" />
        <v-switch v-if="dialog.scope !== 'EMPLOYEE'" v-model="dialog.resend" :label="$t('payslips.resendAll')" color="primary" density="compact" hide-details />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.show = false">{{ $t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="send" :loading="form.busy.value" @click="send">{{ $t('payslips.send') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
