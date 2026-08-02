<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import StatusChip from '../components/StatusChip.vue';

interface DocumentRow {
  id: string;
  type: string;
  label: string | null;
  required: boolean;
  storageKey: string | null;
  uploadedAt: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  at: string;
  metadata: Record<string, unknown> | null;
}

interface TraineeDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  nationalId: string | null;
  birthDate: string | null;
  department: string | null;
  jobTitle: string | null;
  status: string;
  documents: DocumentRow[];
  contract: { id: string; details: Record<string, unknown> | null; sentAt: string | null; approvedAt: string | null } | null;
  employee: { id: string; employeeNo: string } | null;
  auditLogs: AuditRow[];
  availableActions: string[];
}

const { t } = useI18n();
const route = useRoute();
const id = route.params['id'] as string;

const trainee = ref<TraineeDetail | null>(null);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const notesDialog = ref(false);
const notes = ref('');
const contractDialog = ref(false);
const contract = ref({ salary: '', durationMonths: '', startDate: '', terms: '' });

async function load() {
  trainee.value = await api.get<TraineeDetail>(`/api/trainees/${id}`);
  const details = trainee.value.contract?.details as Record<string, string> | null;
  if (details) {
    contract.value = {
      salary: details['salary'] ?? '',
      durationMonths: details['durationMonths'] ?? '',
      startDate: details['startDate'] ?? '',
      terms: details['terms'] ?? '',
    };
  }
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

async function runAction(action: string, body?: unknown) {
  busy.value = action;
  try {
    await api.post(`/api/trainees/${id}/actions/${action}`, body);
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function saveContract() {
  busy.value = 'contract';
  try {
    const details: Record<string, string> = {};
    for (const [k, v] of Object.entries(contract.value)) if (v.trim()) details[k] = v.trim();
    await api.put(`/api/trainees/${id}/contract`, { details });
    contractDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

/** action key → button meta; order defines display order. */
const ACTION_META: Record<string, { icon: string; color: string; endpoint: string }> = {
  SEND_FORM: { icon: 'mdi-send', color: 'primary', endpoint: 'send-form' },
  REQUEST_MISSING: { icon: 'mdi-file-alert', color: 'warning', endpoint: 'request-missing' },
  ACCEPT_DOCUMENTS: { icon: 'mdi-file-check', color: 'success', endpoint: 'accept-documents' },
  SEND_CONTRACT: { icon: 'mdi-file-sign', color: 'primary', endpoint: 'send-contract' },
  REOPEN: { icon: 'mdi-restore', color: 'secondary', endpoint: 'reopen' },
};

const actionButtons = computed(() =>
  (trainee.value?.availableActions ?? [])
    .filter((a) => ACTION_META[a])
    .map((a) => ({ key: a, ...ACTION_META[a]! })),
);

function onAction(key: string, endpoint: string) {
  if (key === 'REQUEST_MISSING') {
    notesDialog.value = true;
    return;
  }
  void runAction(endpoint);
}

const TIMELINE_ICONS: Record<string, string> = {
  CREATE: 'mdi-account-plus',
  STATUS_TRANSITION: 'mdi-arrow-right-bold',
  LINK_SENT: 'mdi-link-variant',
  SLA_REMINDER: 'mdi-bell-ring',
  SEND_FORM: 'mdi-send',
  SUBMIT_FORM: 'mdi-file-upload',
  REQUEST_MISSING: 'mdi-file-alert',
  ACCEPT_DOCUMENTS: 'mdi-file-check',
  SEND_CONTRACT: 'mdi-file-sign',
  APPROVE_CONTRACT: 'mdi-check-decagram',
  EXPIRE: 'mdi-timer-off',
  REOPEN: 'mdi-restore',
};

onMounted(load);
</script>

<template>
  <v-container v-if="trainee" class="py-8" style="max-width: 1200px">
    <!-- Header -->
    <div class="d-flex align-center flex-wrap mb-6" style="gap: 12px">
      <v-btn icon="mdi-arrow-left" variant="text" to="/trainees" class="flip-rtl" />
      <div>
        <h1 class="text-h4 font-weight-bold">
          {{ trainee.firstName }} {{ trainee.lastName }}
          <StatusChip :status="trainee.status" class="ms-2" />
        </h1>
        <p class="text-medium-emphasis mt-1">
          {{ trainee.jobTitle ?? '—' }} · {{ trainee.department ?? '—' }}
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-for="btn in actionButtons"
        :key="btn.key"
        :color="btn.color"
        :prepend-icon="btn.icon"
        :loading="busy === btn.endpoint"
        variant="flat"
        @click="onAction(btn.key, btn.endpoint)"
      >
        {{ $t(`actions.${btn.key}`) }}
      </v-btn>
    </div>

    <v-alert
      v-if="trainee.employee"
      type="success"
      variant="tonal"
      class="mb-6"
      :text="$t('trainees.becameEmployee', { no: trainee.employee.employeeNo })"
    />

    <v-row>
      <!-- Left column: info + documents + contract -->
      <v-col cols="12" md="7">
        <v-card class="mb-4" :title="$t('trainees.info')">
          <v-card-text>
            <v-row dense>
              <v-col cols="6"><strong>{{ $t('trainees.email') }}:</strong> {{ trainee.email }}</v-col>
              <v-col cols="6"><strong>{{ $t('trainees.phone') }}:</strong> {{ trainee.phone ?? '—' }}</v-col>
              <v-col cols="6"><strong>{{ $t('trainees.nationalId') }}:</strong> {{ trainee.nationalId ?? '—' }}</v-col>
              <v-col cols="6">
                <strong>{{ $t('trainees.birthDate') }}:</strong>
                {{ trainee.birthDate ? new Date(trainee.birthDate).toLocaleDateString() : '—' }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

        <v-card class="mb-4" :title="$t('trainees.documents')">
          <v-list>
            <v-list-item v-for="doc in trainee.documents" :key="doc.id">
              <template #prepend>
                <v-icon
                  :icon="doc.storageKey ? 'mdi-file-check' : 'mdi-file-remove-outline'"
                  :color="doc.storageKey ? 'success' : doc.required ? 'error' : 'grey'"
                />
              </template>
              <v-list-item-title>
                {{ doc.label ?? $t(`docTypes.${doc.type}`, doc.type) }}
                <v-chip v-if="!doc.required" size="x-small" class="ms-1" variant="tonal">
                  {{ $t('trainees.optional') }}
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ doc.storageKey ? $t('trainees.uploaded') : $t('trainees.missing') }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="doc.storageKey"
                  icon="mdi-download"
                  variant="text"
                  size="small"
                  :href="`/api/trainees/${trainee.id}/documents/${doc.id}/download`"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card>

        <v-card :title="$t('trainees.contract')">
          <v-card-text>
            <template v-if="trainee.contract">
              <v-row dense>
                <v-col v-for="(v, k) in trainee.contract.details ?? {}" :key="k" cols="6">
                  <strong>{{ $t(`contract.${k}`, String(k)) }}:</strong> {{ v }}
                </v-col>
              </v-row>
              <div class="text-caption text-medium-emphasis mt-2">
                <span v-if="trainee.contract.approvedAt">
                  {{ $t('contract.approvedAt') }}:
                  {{ new Date(trainee.contract.approvedAt).toLocaleString() }}
                </span>
                <span v-else-if="trainee.contract.sentAt">
                  {{ $t('contract.sentAt') }}: {{ new Date(trainee.contract.sentAt).toLocaleString() }}
                </span>
              </div>
            </template>
            <p v-else class="text-medium-emphasis">{{ $t('contract.none') }}</p>
          </v-card-text>
          <v-card-actions v-if="trainee.status === 'CONTRACT_CREATION'">
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-pencil" @click="contractDialog = true">
              {{ trainee.contract ? $t('contract.edit') : $t('contract.createBtn') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Right column: timeline -->
      <v-col cols="12" md="5">
        <v-card :title="$t('trainees.timeline')">
          <v-card-text>
            <v-timeline density="compact" side="end" truncate-line="both">
              <v-timeline-item
                v-for="log in [...trainee.auditLogs].reverse()"
                :key="log.id"
                :icon="TIMELINE_ICONS[log.action] ?? 'mdi-circle-medium'"
                size="small"
                dot-color="primary"
              >
                <div class="text-body-2 font-weight-medium">
                  {{ $t(`audit.${log.action}`, log.action) }}
                  <template v-if="log.fromStatus && log.toStatus">
                    — {{ $t(`status.${log.fromStatus}`) }} ← {{ $t(`status.${log.toStatus}`) }}
                  </template>
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ new Date(log.at).toLocaleString() }} · {{ $t(`actors.${log.actorType}`) }}
                </div>
              </v-timeline-item>
            </v-timeline>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Request-missing notes dialog -->
    <v-dialog v-model="notesDialog" max-width="480">
      <v-card :title="$t('actions.REQUEST_MISSING')" class="pa-2">
        <v-card-text>
          <v-textarea v-model="notes" :label="$t('trainees.missingNotes')" rows="3" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="notesDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="warning"
            :loading="busy === 'request-missing'"
            @click="notesDialog = false; runAction('request-missing', { notes })"
          >
            {{ $t('common.send') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Contract dialog -->
    <v-dialog v-model="contractDialog" max-width="560">
      <v-card :title="$t('trainees.contract')" class="pa-2">
        <v-card-text>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="contract.salary" :label="$t('contract.salary')" /></v-col>
            <v-col cols="6"><v-text-field v-model="contract.durationMonths" :label="$t('contract.durationMonths')" /></v-col>
            <v-col cols="12"><v-text-field v-model="contract.startDate" :label="$t('contract.startDate')" type="date" /></v-col>
            <v-col cols="12"><v-textarea v-model="contract.terms" :label="$t('contract.terms')" rows="3" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="contractDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy === 'contract'" @click="saveContract">
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" timeout="3500">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>

  <v-container v-else class="py-16 text-center">
    <v-progress-circular indeterminate color="primary" size="48" />
  </v-container>
</template>

<style scoped>
[dir='rtl'] .flip-rtl {
  transform: scaleX(-1);
}
</style>
