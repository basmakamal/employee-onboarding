<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { api, ApiError } from '../api/client';
import ProcessCard from '../components/ProcessCard.vue';
import { useAuthStore } from '../stores/auth';

interface ProcessData {
  status: string;
  holdReason?: string | null;
  holdNote?: string | null;
}

interface AssetFormItem {
  id?: string;
  type: string;
  name: string;
  serialNumber?: string | null;
  quantity: number;
  condition: 'NEW' | 'USED';
  notes?: string | null;
}

interface AssetFormRow {
  id: string;
  status: string;
  deliveryDate: string | null;
  rejectReason: string | null;
  createdAt: string;
  items: AssetFormItem[];
}

interface AuditRow {
  id: string;
  entity: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  at: string;
}

interface OffboardingRow {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface EmployeeDetail {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  department: string | null;
  project: string | null;
  jobTitle: string | null;
  hireDate: string;
  status: string;
  gosi: ProcessData | null;
  medical: ProcessData | null;
  criminalRecord: ProcessData | null;
  assetForms: AssetFormRow[];
  offboardings: OffboardingRow[];
  auditLogs: AuditRow[];
  processActions: { gosi: string[]; medical: string[]; criminal: string[] };
}

const OFFBOARDING_REASONS = ['RESIGNATION', 'TERMINATION', 'CONTRACT_EXPIRY', 'RETIREMENT', 'DEATH'];

// ---------------------------------------------------- expiry documents
interface ExpiryDoc {
  id: string;
  type: string;
  number: string | null;
  expiryDate: string;
  notes: string | null;
}

const DOC_TYPES = ['IQAMA', 'NATIONAL_ID', 'PASSPORT', 'CONTRACT', 'WORK_PERMIT', 'DRIVING_LICENSE'];

const GOSI_REASONS = [
  'OPTIONAL_SUBSCRIPTION',
  'GOVERNMENT_EMPLOYEE',
  'DOB_MISMATCH',
  'ID_MISMATCH',
  'INCOMPLETE_DATA',
  'OTHER',
];
const MEDICAL_REASONS = [
  'ELM_DATA_ISSUE',
  'OTHER_INSURANCE_EXISTS',
  'EMPLOYEE_DECLINED',
  'AWAITING_INSURER',
  'INCOMPLETE_DATA',
  'OTHER',
];

const ASSET_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'grey',
  SENT: 'indigo',
  PENDING_EMPLOYEE_APPROVAL: 'amber',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'grey',
};

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const id = route.params['id'] as string;

const employee = ref<EmployeeDetail | null>(null);
const busy = ref('');
const snackbar = ref({ show: false, text: '', color: 'success' });
const formDialog = ref(false);
const linkDialog = ref({ show: false, url: '' });
const newForm = ref<{ deliveryDate: string; items: AssetFormItem[] }>({
  deliveryDate: '',
  items: [emptyItem()],
});

function emptyItem(): AssetFormItem {
  return { type: '', name: '', serialNumber: '', quantity: 1, condition: 'NEW', notes: '' };
}

function notify(text: string, color = 'success') {
  snackbar.value = { show: true, text, color };
}

const expiryDocs = ref<ExpiryDoc[]>([]);
const docDialog = ref(false);
const docForm = ref({ id: '', type: 'IQAMA', customType: '', number: '', expiryDate: '', notes: '' });

async function load() {
  [employee.value, expiryDocs.value] = await Promise.all([
    api.get<EmployeeDetail>(`/api/employees/${id}`),
    api.get<ExpiryDoc[]>(`/api/employees/${id}/documents`),
  ]);
}

function docDaysLeft(doc: ExpiryDoc): number {
  return Math.ceil((new Date(doc.expiryDate).getTime() - Date.now()) / 86_400_000);
}

function docColor(doc: ExpiryDoc): string {
  const days = docDaysLeft(doc);
  if (days < 0) return 'error';
  if (days <= 30) return 'warning';
  return 'success';
}

function openDocDialog(doc?: ExpiryDoc) {
  docForm.value = doc
    ? {
        id: doc.id,
        type: DOC_TYPES.includes(doc.type) ? doc.type : 'CUSTOM',
        customType: DOC_TYPES.includes(doc.type) ? '' : doc.type,
        number: doc.number ?? '',
        expiryDate: doc.expiryDate.slice(0, 10),
        notes: doc.notes ?? '',
      }
    : { id: '', type: 'IQAMA', customType: '', number: '', expiryDate: '', notes: '' };
  docDialog.value = true;
}

async function saveDoc() {
  busy.value = 'doc';
  try {
    const body = {
      type: docForm.value.type === 'CUSTOM' ? docForm.value.customType.trim() : docForm.value.type,
      number: docForm.value.number.trim() || undefined,
      expiryDate: docForm.value.expiryDate,
      notes: docForm.value.notes.trim() || undefined,
    };
    if (docForm.value.id) await api.put(`/api/employee-documents/${docForm.value.id}`, body);
    else await api.post(`/api/employees/${id}/documents`, body);
    docDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function removeDoc(docId: string) {
  busy.value = docId;
  try {
    await api.delete(`/api/employee-documents/${docId}`);
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function actOnProcess(
  kind: 'gosi' | 'medical' | 'criminal',
  action: string,
  payload?: { holdReason?: string; holdNote?: string },
) {
  busy.value = kind;
  try {
    await api.post(`/api/employees/${id}/processes/${kind}/actions/${action.toLowerCase()}`, payload ?? {});
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function createAssetForm() {
  busy.value = 'form';
  try {
    const items = newForm.value.items
      .filter((i) => i.type.trim() && i.name.trim())
      .map((i) => ({
        type: i.type.trim(),
        name: i.name.trim(),
        serialNumber: i.serialNumber?.trim() || undefined,
        quantity: i.quantity,
        condition: i.condition,
        notes: i.notes?.trim() || undefined,
      }));
    await api.post('/api/asset-forms', {
      employeeId: id,
      deliveryDate: newForm.value.deliveryDate || undefined,
      items,
    });
    formDialog.value = false;
    newForm.value = { deliveryDate: '', items: [emptyItem()] };
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

async function actOnForm(formId: string, action: 'send' | 'cancel' | 'revise') {
  busy.value = formId;
  try {
    const result = await api.post<{ url?: string }>(`/api/asset-forms/${formId}/actions/${action}`);
    if (action === 'send' && result.url) linkDialog.value = { show: true, url: result.url };
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

function formActions(status: string): Array<'send' | 'cancel' | 'revise'> {
  if (status === 'DRAFT') return ['send', 'cancel'];
  if (status === 'SENT' || status === 'PENDING_EMPLOYEE_APPROVAL') return ['cancel'];
  if (status === 'REJECTED') return ['revise'];
  return [];
}

// ------------------------------------------------------------- offboarding
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const offboardingDialog = ref(false);
const offboardingForm = ref({ reason: 'RESIGNATION', notes: '' });

const openOffboarding = computed(() =>
  employee.value?.offboardings.find((o) => !['CLOSED', 'CANCELLED'].includes(o.status)),
);

async function startOffboarding() {
  busy.value = 'offboarding';
  try {
    const created = await api.post<{ id: string }>('/api/offboardings', {
      employeeId: id,
      reason: offboardingForm.value.reason,
      notes: offboardingForm.value.notes || undefined,
    });
    offboardingDialog.value = false;
    await router.push(`/offboardings/${created.id}`);
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <v-container v-if="employee" class="py-8" style="max-width: 1200px">
    <!-- Header -->
    <div class="d-flex align-center flex-wrap mb-6" style="gap: 12px">
      <v-btn icon="mdi-arrow-left" variant="text" to="/employees" class="flip-rtl" />
      <div>
        <h1 class="text-h4 font-weight-bold">
          {{ employee.firstName }} {{ employee.lastName }}
          <v-chip color="primary" variant="tonal" size="small" class="ms-2 font-weight-bold">
            {{ employee.employeeNo }}
          </v-chip>
          <v-chip
            :color="employee.status === 'ACTIVE' ? 'success' : 'grey'"
            variant="tonal"
            size="small"
            class="ms-1"
          >
            {{ $t(`employees.statuses.${employee.status}`) }}
          </v-chip>
        </h1>
        <p class="text-medium-emphasis mt-1">
          {{ employee.jobTitle ?? '—' }} · {{ employee.department ?? '—' }} ·
          {{ $t('employees.hired') }} {{ new Date(employee.hireDate).toLocaleDateString() }}
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-if="!openOffboarding && employee.status === 'ACTIVE' && auth.hasRole('HR')"
        color="warning"
        variant="tonal"
        prepend-icon="mdi-exit-run"
        @click="offboardingDialog = true"
      >
        {{ $t('offboarding.start') }}
      </v-btn>
    </div>

    <!-- Offboarding banner -->
    <v-alert
      v-if="openOffboarding"
      type="warning"
      variant="tonal"
      class="mb-6"
      :title="$t('offboarding.inProgress')"
    >
      {{ $t(`offboardingReasons.${openOffboarding.reason}`) }} —
      {{ $t(`offboardingStatus.${openOffboarding.status}`) }}
      <template #append>
        <v-btn
          color="warning"
          variant="flat"
          size="small"
          :to="`/offboardings/${openOffboarding.id}`"
        >
          {{ $t('offboarding.open') }}
        </v-btn>
      </template>
    </v-alert>

    <!-- BRD Stage 2: the three independent processes -->
    <v-row class="mb-2">
      <v-col cols="12" md="4">
        <ProcessCard
          :title="$t('processes.gosi')"
          icon="mdi-shield-account"
          :process="employee.gosi"
          :actions="employee.processActions.gosi"
          :hold-reasons="GOSI_REASONS"
          :busy="busy === 'gosi'"
          @act="(a, p) => actOnProcess('gosi', a, p)"
        />
      </v-col>
      <v-col cols="12" md="4">
        <ProcessCard
          :title="$t('processes.medical')"
          icon="mdi-hospital-box"
          :process="employee.medical"
          :actions="employee.processActions.medical"
          :hold-reasons="MEDICAL_REASONS"
          :busy="busy === 'medical'"
          @act="(a, p) => actOnProcess('medical', a, p)"
        />
      </v-col>
      <v-col cols="12" md="4">
        <ProcessCard
          :title="$t('processes.criminal')"
          icon="mdi-file-certificate"
          :process="employee.criminalRecord"
          :actions="employee.processActions.criminal"
          :hold-reasons="[]"
          :busy="busy === 'criminal'"
          @act="(a) => actOnProcess('criminal', a)"
        />
      </v-col>
    </v-row>

    <v-row>
      <!-- Assets -->
      <v-col cols="12" md="7">
        <!-- Expiry-tracked documents -->
        <v-card class="mb-4">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-card-account-details" class="me-2" color="primary" />
              {{ $t('expiryDocs.title') }}
            </v-card-title>
            <template #append>
              <v-btn
                v-if="auth.hasRole('HR')"
                color="primary"
                size="small"
                prepend-icon="mdi-plus"
                @click="openDocDialog()"
              >
                {{ $t('expiryDocs.add') }}
              </v-btn>
            </template>
          </v-card-item>
          <v-card-text v-if="expiryDocs.length === 0" class="text-medium-emphasis">
            {{ $t('expiryDocs.empty') }}
          </v-card-text>
          <v-list v-else density="compact">
            <v-list-item v-for="doc in expiryDocs" :key="doc.id">
              <template #prepend>
                <v-icon icon="mdi-file-clock" :color="docColor(doc)" />
              </template>
              <v-list-item-title>
                {{ $t(`expiryDocs.types.${doc.type}`, doc.type) }}
                <span v-if="doc.number" class="text-medium-emphasis">· {{ doc.number }}</span>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ new Date(doc.expiryDate).toLocaleDateString() }}
                <v-chip :color="docColor(doc)" size="x-small" variant="tonal" class="ms-1">
                  {{
                    docDaysLeft(doc) < 0
                      ? $t('expiryDocs.expired', { n: -docDaysLeft(doc) })
                      : $t('expiryDocs.daysLeft', { n: docDaysLeft(doc) })
                  }}
                </v-chip>
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="auth.hasRole('HR')"
                  icon="mdi-pencil"
                  variant="text"
                  size="small"
                  @click="openDocDialog(doc)"
                />
                <v-btn
                  v-if="auth.hasRole('HR')"
                  icon="mdi-delete"
                  variant="text"
                  size="small"
                  color="error"
                  :loading="busy === doc.id"
                  @click="removeDoc(doc.id)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
        <v-card>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-laptop" class="me-2" color="secondary" />
              {{ $t('assets.title') }}
            </v-card-title>
            <template #append>
              <v-btn
                v-if="auth.hasRole('IT')"
                color="primary"
                size="small"
                prepend-icon="mdi-plus"
                @click="formDialog = true"
              >
                {{ $t('assets.newForm') }}
              </v-btn>
            </template>
          </v-card-item>

          <v-card-text v-if="employee.assetForms.length === 0" class="text-medium-emphasis">
            {{ $t('assets.empty') }}
          </v-card-text>

          <v-expansion-panels v-else variant="accordion">
            <v-expansion-panel v-for="form in employee.assetForms" :key="form.id">
              <v-expansion-panel-title>
                <v-chip
                  :color="ASSET_STATUS_COLORS[form.status]"
                  size="small"
                  variant="tonal"
                  class="me-3 font-weight-medium"
                >
                  {{ $t(`assetStatus.${form.status}`) }}
                </v-chip>
                {{ form.items.length }} {{ $t('assets.items') }} ·
                {{ new Date(form.createdAt).toLocaleDateString() }}
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <v-alert v-if="form.rejectReason" type="error" variant="tonal" density="compact" class="mb-3">
                  {{ $t('assets.rejectReason') }}: {{ form.rejectReason }}
                </v-alert>
                <v-table density="compact">
                  <thead>
                    <tr>
                      <th>{{ $t('assets.type') }}</th>
                      <th>{{ $t('assets.name') }}</th>
                      <th>{{ $t('assets.serial') }}</th>
                      <th>{{ $t('assets.qty') }}</th>
                      <th>{{ $t('assets.condition') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, i) in form.items" :key="i">
                      <td>{{ item.type }}</td>
                      <td>{{ item.name }}</td>
                      <td>{{ item.serialNumber ?? '—' }}</td>
                      <td>{{ item.quantity }}</td>
                      <td>{{ $t(`conditions.${item.condition}`) }}</td>
                    </tr>
                  </tbody>
                </v-table>
                <div class="d-flex mt-3" style="gap: 8px">
                  <v-btn
                    v-for="action in formActions(form.status)"
                    :key="action"
                    :color="action === 'cancel' ? 'error' : 'primary'"
                    :loading="busy === form.id"
                    size="small"
                    variant="tonal"
                    @click="actOnForm(form.id, action)"
                  >
                    {{ $t(`assets.actions.${action}`) }}
                  </v-btn>
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card>
      </v-col>

      <!-- Timeline -->
      <v-col cols="12" md="5">
        <v-card :title="$t('trainees.timeline')">
          <v-card-text>
            <v-timeline density="compact" side="end" truncate-line="both">
              <v-timeline-item
                v-for="log in [...employee.auditLogs].reverse()"
                :key="log.id"
                size="small"
                dot-color="secondary"
              >
                <div class="text-body-2 font-weight-medium">
                  {{ $t(`entities.${log.entity}`, log.entity) }} —
                  {{ $t(`audit.${log.action}`, log.action) }}
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

    <!-- New custody form dialog -->
    <v-dialog v-model="formDialog" max-width="760">
      <v-card :title="$t('assets.newForm')" class="pa-2">
        <v-card-text>
          <v-text-field
            v-model="newForm.deliveryDate"
            :label="$t('assets.deliveryDate')"
            type="date"
            style="max-width: 240px"
          />
          <div v-for="(item, i) in newForm.items" :key="i" class="item-row mb-2">
            <v-row dense>
              <v-col cols="6" sm="2"><v-text-field v-model="item.type" :label="$t('assets.type')" density="compact" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="item.name" :label="$t('assets.name')" density="compact" /></v-col>
              <v-col cols="6" sm="3"><v-text-field v-model="item.serialNumber" :label="$t('assets.serial')" density="compact" /></v-col>
              <v-col cols="3" sm="1"><v-text-field v-model.number="item.quantity" :label="$t('assets.qty')" type="number" min="1" density="compact" /></v-col>
              <v-col cols="3" sm="2">
                <v-select
                  v-model="item.condition"
                  :items="[{ title: $t('conditions.NEW'), value: 'NEW' }, { title: $t('conditions.USED'), value: 'USED' }]"
                  :label="$t('assets.condition')"
                  density="compact"
                />
              </v-col>
              <v-col cols="12" sm="1" class="d-flex align-center">
                <v-btn
                  icon="mdi-delete"
                  variant="text"
                  size="small"
                  color="error"
                  :disabled="newForm.items.length === 1"
                  @click="newForm.items.splice(i, 1)"
                />
              </v-col>
            </v-row>
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-plus" @click="newForm.items.push(emptyItem())">
            {{ $t('assets.addItem') }}
          </v-btn>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="formDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'form'"
            :disabled="!newForm.items.some((i) => i.type.trim() && i.name.trim())"
            @click="createAssetForm"
          >
            {{ $t('common.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Signed link dialog (dev convenience: email goes to the console) -->
    <v-dialog v-model="linkDialog.show" max-width="620">
      <v-card :title="$t('assets.linkSent')" class="pa-2">
        <v-card-text>
          <p class="text-medium-emphasis mb-3">{{ $t('assets.linkHint') }}</p>
          <v-text-field :model-value="linkDialog.url" readonly density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="linkDialog.show = false">{{ $t('common.done') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Expiry document dialog -->
    <v-dialog v-model="docDialog" max-width="480">
      <v-card :title="docForm.id ? $t('expiryDocs.edit') : $t('expiryDocs.add')" class="pa-2">
        <v-card-text>
          <v-select
            v-model="docForm.type"
            :items="[
              ...DOC_TYPES.map((type) => ({ title: $t(`expiryDocs.types.${type}`), value: type })),
              { title: $t('expiryDocs.types.CUSTOM'), value: 'CUSTOM' },
            ]"
            :label="$t('assets.type')"
          />
          <v-text-field
            v-if="docForm.type === 'CUSTOM'"
            v-model="docForm.customType"
            :label="$t('expiryDocs.customType')"
          />
          <v-text-field v-model="docForm.number" :label="$t('expiryDocs.number')" />
          <v-text-field v-model="docForm.expiryDate" :label="$t('expiryDocs.expiry')" type="date" />
          <v-textarea v-model="docForm.notes" :label="$t('assets.notes')" rows="2" />
          <v-alert v-if="docForm.id" type="info" variant="tonal" density="compact">
            {{ $t('expiryDocs.renewHint') }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="docDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'doc'"
            :disabled="!docForm.expiryDate || (docForm.type === 'CUSTOM' && !docForm.customType.trim())"
            @click="saveDoc"
          >
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Start offboarding dialog -->
    <v-dialog v-model="offboardingDialog" max-width="480">
      <v-card :title="$t('offboarding.start')" class="pa-2">
        <v-card-text>
          <v-select
            v-model="offboardingForm.reason"
            :items="OFFBOARDING_REASONS.map((r) => ({ title: $t(`offboardingReasons.${r}`), value: r }))"
            :label="$t('offboarding.reason')"
          />
          <v-textarea v-model="offboardingForm.notes" :label="$t('assets.notes')" rows="2" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="offboardingDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="warning" :loading="busy === 'offboarding'" @click="startOffboarding">
            {{ $t('common.create') }}
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
