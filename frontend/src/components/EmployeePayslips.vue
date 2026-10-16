<script setup lang="ts">
/** The employee's payslips (approved months) on the Pay tab — download any month, see when it was e-mailed. */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api/client';
import { downloadFile } from '../composables/useDownload';
import { errorText } from '../validation/errors';

interface Slip { lineId: string; month: string; net: number; gross: number; sentAt: string | null; sentTo: string | null }

const props = defineProps<{ employeeId: string; employeeNo: string | null }>();
const { locale } = useI18n();
const ar = computed(() => locale.value.startsWith('ar'));
const money = (n: number) => n.toLocaleString(ar.value ? 'ar-SA' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const stamp = (iso: string) => new Date(iso).toLocaleDateString(ar.value ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short' });

const slips = ref<Slip[]>([]);
const error = ref('');
onMounted(async () => {
  try {
    slips.value = await api.get<Slip[]>(`/api/employees/${props.employeeId}/payslips`);
  } catch (e) {
    error.value = errorText(e);
  }
});
async function download(s: Slip) {
  try {
    await downloadFile(`/api/employees/${props.employeeId}/payslips/${s.lineId}/payslip.pdf`, `payslip-${s.month}-${props.employeeNo ?? props.employeeId}.pdf`);
  } catch (e) {
    error.value = errorText(e);
  }
}
</script>

<template>
  <v-card :title="$t('payslips.title')" class="mb-4">
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
      <div v-if="slips.length === 0" class="text-body-2 text-medium-emphasis">{{ $t('payslips.none') }}</div>
      <div v-for="s in slips" :key="s.lineId" class="d-flex align-center flex-wrap ga-2 py-2 srow">
        <v-icon icon="file-text" size="18" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">{{ monthLabel(s.month) }} · <span dir="ltr">{{ money(s.net) }}</span></div>
          <div class="text-caption text-medium-emphasis">
            <template v-if="s.sentAt">{{ $t('payslips.sentOn', { date: stamp(s.sentAt) }) }} <span dir="ltr">{{ s.sentTo ?? '' }}</span></template>
            <template v-else>{{ $t('payslips.notSent') }}</template>
          </div>
        </div>
        <v-btn size="small" variant="text" prepend-icon="download" @click="download(s)">PDF</v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.srow + .srow { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
</style>
