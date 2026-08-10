<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, getAccessToken } from '../api/client';
import ProcessCard from '../components/ProcessCard.vue';
import StatusChip from '../components/StatusChip.vue';
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

interface ContractSummary {
  startDate: string | null;
  durationMonths: number | null;
  terms: string | null;
  salary?: number | null;
  sentAt: string | null;
  approvedAt: string | null;
}

interface OnboardingDoc {
  id: string;
  type: string;
  label: string | null;
  required: boolean;
  uploaded: boolean;
}

interface RequestRow {
  id: string;
  type: string;
  notes: string | null;
  createdAt: string;
  createdBy: { name: string };
}

interface EmployeeDetail {
  id: string;
  employeeNo: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  nationalId: string | null;
  birthDate: string | null;
  department: string | null;
  project: string | null;
  jobTitle: string | null;
  directManager: string | null;
  employmentType: string;
  photoKey: string | null;
  hireDate: string | null;
  status: string;
  contract: ContractSummary | null;
  onboardingDocuments: OnboardingDoc[];
  requests: RequestRow[];
  gosi: ProcessData | null;
  medical: ProcessData | null;
  criminalRecord: ProcessData | null;
  assetForms: AssetFormRow[];
  offboardings: OffboardingRow[];
  auditLogs: AuditRow[];
  availableActions: string[];
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

const { t, locale } = useI18n();
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
  void loadPhoto();
}

// ------------------------------------------------------------- profile photo
const photoUrl = ref('');
const photoInput = ref<HTMLInputElement | null>(null);

async function loadPhoto() {
  if (!employee.value?.photoKey) {
    photoUrl.value = '';
    return;
  }
  const res = await fetch(`/api/employees/${id}/photo`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (res.ok) {
    if (photoUrl.value) URL.revokeObjectURL(photoUrl.value);
    photoUrl.value = URL.createObjectURL(await res.blob());
  }
}

async function onPhotoPicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = 'photo';
  try {
    const body = new FormData();
    body.append('photo', file);
    await api.post(`/api/employees/${id}/photo`, body);
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    if (photoInput.value) photoInput.value.value = '';
  }
}

const initials = computed(() => {
  const e = employee.value;
  return e ? `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase() : '';
});

/** The reference's "employee status" panel: is anything still missing? */
const missingCount = computed(() => {
  const e = employee.value;
  if (!e) return 0;
  const gaps = [e.phone, e.nationalId, e.birthDate, e.department, e.jobTitle].filter(
    (v) => !v,
  ).length;
  const missingDocs = e.onboardingDocuments.filter((d) => d.required && !d.uploaded).length;
  return gaps + missingDocs;
});

// ------------------------------------------------------------- edit profile
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'TEMPORARY'];
const editDialog = ref(false);

/** Known departments / job titles — new typed values join the list on save. */
const fieldOptions = ref<{ departments: string[]; jobTitles: string[] }>({
  departments: [],
  jobTitles: [],
});
const editForm = ref({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  nationalId: '',
  birthDate: '',
  department: '',
  project: '',
  jobTitle: '',
  directManager: '',
  employmentType: 'FULL_TIME',
  hireDate: '',
});

function openEdit() {
  const e = employee.value;
  if (!e) return;
  void api
    .get<{ departments: string[]; jobTitles: string[] }>('/api/employees/options')
    .then((opts) => (fieldOptions.value = opts));
  editForm.value = {
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone ?? '',
    nationalId: e.nationalId ?? '',
    birthDate: e.birthDate?.slice(0, 10) ?? '',
    department: e.department ?? '',
    project: e.project ?? '',
    jobTitle: e.jobTitle ?? '',
    directManager: e.directManager ?? '',
    employmentType: e.employmentType,
    hireDate: e.hireDate?.slice(0, 10) ?? '',
  };
  editDialog.value = true;
}

async function saveEdit() {
  busy.value = 'edit';
  try {
    const f = editForm.value;
    // Empty optional fields clear the column (null); required ones are trimmed.
    await api.put(`/api/employees/${id}`, {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: f.email.trim(),
      phone: f.phone.trim() || null,
      nationalId: f.nationalId.trim() || null,
      birthDate: f.birthDate || null,
      department: (f.department ?? '').trim() || null,
      project: f.project.trim() || null,
      jobTitle: (f.jobTitle ?? '').trim() || null,
      directManager: f.directManager.trim() || null,
      employmentType: f.employmentType,
      ...(f.hireDate ? { hireDate: f.hireDate } : {}),
    });
    editDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
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

// ------------------------------------------------------------- tabs
const tab = ref('overview');

// ------------------------------------------------------- onboarding pipeline
const PIPELINE_STAGES = [
  'CREATED',
  'AWAITING_FORM',
  'FORM_RECEIVED',
  'CONTRACT_CREATION',
  'AWAITING_CONTRACT_APPROVAL',
];

const ONBOARDING_ACTIONS: Record<string, { endpoint: string; icon: string; color: string }> = {
  SEND_FORM: { endpoint: 'send-form', icon: 'mdi-send', color: 'primary' },
  REQUEST_MISSING: { endpoint: 'request-missing', icon: 'mdi-file-alert', color: 'warning' },
  ACCEPT_DOCUMENTS: { endpoint: 'accept-documents', icon: 'mdi-file-check', color: 'success' },
  SEND_CONTRACT: { endpoint: 'send-contract', icon: 'mdi-file-sign', color: 'primary' },
  REOPEN: { endpoint: 'reopen', icon: 'mdi-restore', color: 'secondary' },
};

const isPipeline = computed(
  () => !!employee.value && !['ACTIVE', 'INACTIVE'].includes(employee.value.status),
);

const onboardingButtons = computed(
  () =>
    employee.value?.availableActions
      .filter((a) => ONBOARDING_ACTIONS[a])
      .map((a) => ({ action: a, ...ONBOARDING_ACTIONS[a]! })) ?? [],
);

const notesDialog = ref(false);
const missingNotes = ref('');

async function runOnboardingAction(endpoint: string, body?: { notes?: string }) {
  busy.value = endpoint;
  try {
    const result = await api.post<{ url?: string }>(
      `/api/employees/${id}/actions/${endpoint}`,
      body ?? {},
    );
    if (result.url) linkDialog.value = { show: true, url: result.url };
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

function onOnboardingAction(action: string) {
  if (action === 'REQUEST_MISSING') {
    missingNotes.value = '';
    notesDialog.value = true;
    return;
  }
  void runOnboardingAction(ONBOARDING_ACTIONS[action]!.endpoint);
}

/** HR reviews an uploaded checklist file — authenticated blob download. */
async function downloadOnboardingDoc(doc: OnboardingDoc) {
  const res = await fetch(`/api/employees/${id}/onboarding-documents/${doc.id}/download`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) {
    notify(t('common.error'), 'error');
    return;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.label ?? doc.type;
  a.click();
  URL.revokeObjectURL(url);
}

// Contract drafting (CONTRACT_CREATION only)
const contractDialog = ref(false);
const contractForm = ref({ salary: '', durationMonths: '', startDate: '', terms: '' });

function openContractDialog() {
  const c = employee.value?.contract;
  contractForm.value = {
    salary: c?.salary != null ? String(c.salary) : '',
    durationMonths: c?.durationMonths != null ? String(c.durationMonths) : '',
    startDate: typeof c?.startDate === 'string' ? c.startDate.slice(0, 10) : '',
    terms: c?.terms ?? '',
  };
  contractDialog.value = true;
}

async function saveContract() {
  busy.value = 'contract';
  try {
    const details: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(contractForm.value)) if (v.trim()) details[k] = v.trim();
    await api.put(`/api/employees/${id}/contract`, { details });
    contractDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

// ------------------------------------------------------------- requests & services
const REQUEST_TYPES = [
  { type: 'SALARY_LETTER', icon: 'mdi-file-account-outline' },
  { type: 'BANK_LETTER', icon: 'mdi-bank-outline' },
  { type: 'DEPARTMENT_CHANGE', icon: 'mdi-sitemap-outline' },
  { type: 'JOB_TITLE_CHANGE', icon: 'mdi-account-convert' },
  { type: 'PROMOTION', icon: 'mdi-arrow-up-bold-circle-outline' },
  { type: 'PROJECT_TRANSFER', icon: 'mdi-swap-horizontal' },
  { type: 'WARNING', icon: 'mdi-alert-outline' },
  { type: 'INVESTIGATION', icon: 'mdi-magnify' },
];

const requestDialog = ref({ show: false, type: 'SALARY_LETTER', notes: '' });

function openRequest(type: string) {
  requestDialog.value = { show: true, type, notes: '' };
}

async function submitRequest() {
  busy.value = 'request';
  try {
    await api.post(`/api/employees/${id}/requests`, {
      type: requestDialog.value.type,
      notes: requestDialog.value.notes.trim() || undefined,
    });
    requestDialog.value.show = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

// ------------------------------------------------------------- AI letter
const letterDialog = ref({ show: false, type: '', text: '', loading: false });

async function generateLetter(request: RequestRow) {
  letterDialog.value = { show: true, type: request.type, text: '', loading: true };
  try {
    const { letter } = await api.post<{ letter: string }>('/api/ai/letters', {
      employeeId: id,
      type: request.type,
      notes: request.notes ?? undefined,
      locale: locale.value.startsWith('ar') ? 'ar' : 'en',
    });
    letterDialog.value.text = letter;
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
    letterDialog.value.show = false;
  } finally {
    letterDialog.value.loading = false;
  }
}

async function copyLetter() {
  await navigator.clipboard.writeText(letterDialog.value.text);
  notify(t('ai.copied'));
}

function printLetter() {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const dir = locale.value.startsWith('ar') ? 'rtl' : 'ltr';
  const safe = letterDialog.value.text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  w.document.write(
    `<pre style="font-family: 'Times New Roman', serif; font-size: 16px; line-height: 1.9; white-space: pre-wrap; direction: ${dir}; padding: 48px;">${safe}</pre>`,
  );
  w.document.close();
  w.print();
}

// -------------------------------------------------- AI document extraction
const scanInput = ref<HTMLInputElement | null>(null);

async function onScanPicked(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  busy.value = 'scan';
  try {
    const body = new FormData();
    body.append('document', file);
    const extracted = await api.post<{
      type: string;
      number: string | null;
      expiryDate: string | null;
      notes: string | null;
    }>('/api/ai/extract-document', body);

    if (DOC_TYPES.includes(extracted.type)) {
      docForm.value.type = extracted.type;
    } else {
      docForm.value.type = 'CUSTOM';
      docForm.value.customType = extracted.type;
    }
    if (extracted.number) docForm.value.number = extracted.number;
    if (extracted.expiryDate) docForm.value.expiryDate = extracted.expiryDate;
    if (extracted.notes) docForm.value.notes = extracted.notes;
    notify(t('ai.scanned'));
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
    if (scanInput.value) scanInput.value.value = '';
  }
}

// ------------------------------------------------------------- contract card
const showTerms = ref(false);

const contractEnd = computed(() => {
  const c = employee.value?.contract;
  if (!c?.startDate || !c.durationMonths) return null;
  const end = new Date(c.startDate);
  end.setMonth(end.getMonth() + Number(c.durationMonths));
  return end;
});

const contractRemainingMonths = computed(() => {
  if (!contractEnd.value) return null;
  return Math.max(0, Math.ceil((contractEnd.value.getTime() - Date.now()) / (30.44 * 86_400_000)));
});

const contractState = computed<'active' | 'expired' | 'awaiting' | null>(() => {
  const c = employee.value?.contract;
  if (!c) return null;
  if (!c.approvedAt) return 'awaiting';
  if (contractEnd.value && contractEnd.value.getTime() < Date.now()) return 'expired';
  return 'active';
});

/** The fourth process tile — custody at a glance. */
const custodySummary = computed(() => {
  const forms = employee.value?.assetForms ?? [];
  return {
    latest: forms[0] ?? null,
    approvedItems: forms
      .filter((f) => f.status === 'APPROVED')
      .reduce((n, f) => n + f.items.length, 0),
  };
});

// ------------------------------------------------------------- hard delete
const router = useRouter();
const deleteDialog = ref(false);

async function removeEmployee() {
  busy.value = 'delete';
  try {
    await api.delete(`/api/employees/${id}`);
    deleteDialog.value = false;
    await router.push('/employees');
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
    busy.value = '';
  }
}

// ------------------------------------------------------------- offboarding
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
    <div class="d-flex align-center mb-4" style="gap: 8px">
      <v-btn icon="mdi-arrow-left" variant="text" to="/employees" class="flip-rtl" />
      <span class="text-medium-emphasis text-body-2">
        {{ $t('employees.title') }} / {{ employee.firstName }} {{ employee.lastName }}
      </span>
    </div>

    <!-- Profile card -->
    <v-card class="mb-6 profile-card" elevation="1">
      <v-card-text class="pa-6">
        <div class="d-flex flex-wrap align-start" style="gap: 24px">
          <!-- Photo -->
          <div class="position-relative flex-shrink-0">
            <v-avatar size="96" color="primary" variant="tonal">
              <v-img v-if="photoUrl" :src="photoUrl" cover />
              <span v-else class="text-h4 font-weight-bold">{{ initials }}</span>
            </v-avatar>
            <v-btn
              v-if="auth.hasRole('HR')"
              icon="mdi-camera"
              size="x-small"
              color="primary"
              class="photo-edit-btn"
              :loading="busy === 'photo'"
              :title="$t('profile.uploadPhoto')"
              @click="photoInput?.click()"
            />
            <input
              ref="photoInput"
              type="file"
              accept="image/jpeg,image/png"
              class="d-none"
              @change="onPhotoPicked"
            />
          </div>

          <!-- Identity -->
          <div class="flex-grow-1" style="min-width: 220px">
            <h1 class="text-h4 font-weight-bold mb-1">
              {{ employee.firstName }} {{ employee.lastName }}
            </h1>
            <div class="text-medium-emphasis">
              {{ employee.jobTitle ?? '—' }}<template v-if="employee.department">
                · {{ employee.department }}</template
              >
            </div>
            <div class="mt-2">
              <StatusChip :status="employee.status" />
            </div>
          </div>

          <!-- Status panel (حالة الموظف) -->
          <v-sheet class="status-panel pa-4 text-center flex-shrink-0" rounded="lg">
            <div class="text-subtitle-2 font-weight-bold mb-2">
              {{ $t('profile.statusTitle') }}
            </div>
            <v-icon
              :icon="
                employee.status === 'ACTIVE'
                  ? 'mdi-check-circle-outline'
                  : employee.status === 'INACTIVE'
                    ? 'mdi-pause-circle-outline'
                    : 'mdi-progress-clock'
              "
              :color="
                employee.status === 'ACTIVE'
                  ? 'success'
                  : employee.status === 'INACTIVE'
                    ? 'grey'
                    : 'warning'
              "
              size="44"
            />
            <div class="mt-2">
              <StatusChip :status="employee.status" />
            </div>
            <div
              class="text-caption mt-2"
              :class="missingCount === 0 ? 'text-success' : 'text-warning'"
            >
              {{
                missingCount === 0
                  ? $t('profile.dataComplete')
                  : $t('profile.dataMissing', { n: missingCount })
              }}
            </div>
          </v-sheet>
        </div>

        <v-divider class="my-5" />

        <!-- Info grid -->
        <v-row dense>
          <v-col
            v-for="field in [
              { label: $t('employees.no'), value: employee.employeeNo },
              { label: $t('fields.department'), value: employee.department },
              { label: $t('employees.project'), value: employee.project },
              { label: $t('fields.nationalId'), value: employee.nationalId },
              {
                label: $t('fields.birthDate'),
                value: employee.birthDate ? new Date(employee.birthDate).toLocaleDateString() : null,
              },
              { label: $t('fields.phone'), value: employee.phone },
              { label: $t('fields.email'), value: employee.email },
              {
                label: $t('employees.hireDate'),
                value: employee.hireDate ? new Date(employee.hireDate).toLocaleDateString() : null,
              },
              {
                label: $t('profile.employmentType'),
                value: $t(`profile.types.${employee.employmentType}`),
              },
              { label: $t('profile.directManager'), value: employee.directManager },
            ]"
            :key="field.label"
            cols="6"
            sm="4"
            md="2"
            class="info-cell"
          >
            <div class="text-caption text-medium-emphasis">{{ field.label }}</div>
            <div class="text-body-2 font-weight-medium">{{ field.value ?? '—' }}</div>
          </v-col>
        </v-row>

        <v-divider class="my-5" />

        <!-- Actions -->
        <div class="d-flex flex-wrap align-center" style="gap: 12px">
          <!-- Onboarding pipeline actions (server-driven, machine-legal only) -->
          <v-btn
            v-for="btn in onboardingButtons"
            :key="btn.action"
            :color="btn.color"
            variant="tonal"
            :prepend-icon="btn.icon"
            :loading="busy === btn.endpoint"
            @click="onOnboardingAction(btn.action)"
          >
            {{ $t(`actions.${btn.action}`) }}
          </v-btn>
          <v-btn
            v-if="isPipeline && employee.status === 'CONTRACT_CREATION' && auth.hasRole('HR')"
            color="indigo"
            variant="tonal"
            prepend-icon="mdi-file-document-edit"
            @click="openContractDialog"
          >
            {{ employee.contract ? $t('contract.edit') : $t('contract.createBtn') }}
          </v-btn>

          <v-menu v-if="!isPipeline">
            <template #activator="{ props }">
              <v-btn v-bind="props" color="primary" variant="tonal" prepend-icon="mdi-plus-circle-outline">
                {{ $t('profile.newAction') }}
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item
                v-if="auth.hasRole('IT')"
                prepend-icon="mdi-laptop"
                :title="$t('assets.newForm')"
                @click="formDialog = true"
              />
              <v-list-item
                v-if="auth.hasRole('HR')"
                prepend-icon="mdi-file-clock"
                :title="$t('expiryDocs.add')"
                @click="openDocDialog()"
              />
              <v-list-item
                v-if="auth.hasRole('HR')"
                prepend-icon="mdi-hand-extended-outline"
                :title="$t('requests.new')"
                @click="openRequest('SALARY_LETTER')"
              />
              <v-list-item
                v-if="auth.hasRole('HR') && !openOffboarding && employee.status === 'ACTIVE'"
                prepend-icon="mdi-exit-run"
                :title="$t('offboarding.start')"
                @click="offboardingDialog = true"
              />
            </v-list>
          </v-menu>
          <v-btn
            v-if="auth.hasRole('HR')"
            variant="outlined"
            prepend-icon="mdi-pencil"
            @click="openEdit"
          >
            {{ $t('profile.edit') }}
          </v-btn>
          <v-spacer />
          <v-btn
            v-if="!openOffboarding && employee.status === 'ACTIVE' && auth.hasRole('HR')"
            color="error"
            variant="outlined"
            prepend-icon="mdi-logout-variant"
            @click="offboardingDialog = true"
          >
            {{ $t('profile.endContract') }}
          </v-btn>
          <v-tooltip
            v-if="auth.user?.role === 'ADMIN'"
            location="top"
            :text="$t('profile.delete')"
          >
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-forever-outline"
                variant="text"
                color="error"
                @click="deleteDialog = true"
              />
            </template>
          </v-tooltip>
        </div>
      </v-card-text>
    </v-card>

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

    <!-- Overview / Timeline tabs -->
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="overview" prepend-icon="mdi-view-dashboard-outline">
        {{ $t('profile.overview') }}
      </v-tab>
      <v-tab value="timeline" prepend-icon="mdi-history">
        {{ $t('profile.timelineTab') }}
      </v-tab>
    </v-tabs>

    <v-window v-model="tab" :touch="false">
      <v-window-item value="overview">
    <!-- Onboarding pipeline progress (pre-activation) -->
    <v-card v-if="isPipeline" class="mb-6">
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">
          <v-icon icon="mdi-school" class="me-2" color="primary" />
          {{ $t('onboarding.section') }}
        </v-card-title>
      </v-card-item>
      <v-card-text>
        <div class="d-flex flex-wrap align-center mb-2" style="gap: 8px">
          <template v-for="(stage, i) in PIPELINE_STAGES" :key="stage">
            <v-chip
              :color="
                stage === employee.status
                  ? 'primary'
                  : PIPELINE_STAGES.indexOf(employee.status) > i
                    ? 'success'
                    : 'grey'
              "
              :variant="stage === employee.status ? 'flat' : 'tonal'"
              size="small"
              :prepend-icon="
                PIPELINE_STAGES.indexOf(employee.status) > i ? 'mdi-check' : undefined
              "
            >
              {{ $t(`status.${stage}`) }}
            </v-chip>
            <v-icon
              v-if="i < PIPELINE_STAGES.length - 1"
              icon="mdi-chevron-right"
              size="16"
              class="text-medium-emphasis flip-rtl"
            />
          </template>
        </div>
        <v-alert
          v-if="employee.status === 'EXPIRED'"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2 mb-0"
        >
          {{ $t('status.EXPIRED') }} — {{ $t(`audit.EXPIRE`) }}
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- BRD Stage 2: the independent processes (عمليات الموظف) -->
    <template v-if="!isPipeline">
    <h2 class="text-subtitle-1 font-weight-bold mb-3">{{ $t('profile.processes') }}</h2>
    <v-row class="mb-2">
      <v-col cols="12" sm="6" md="3">
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
      <v-col cols="12" sm="6" md="3">
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
      <v-col cols="12" sm="6" md="3">
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
      <!-- Custody at a glance (إدارة العهد) -->
      <v-col cols="12" sm="6" md="3">
        <v-card class="h-100">
          <v-card-text class="text-center py-5">
            <v-icon icon="mdi-package-variant-closed" size="36" color="deep-purple" class="mb-2" />
            <div class="text-subtitle-2 font-weight-bold mb-2">{{ $t('assets.title') }}</div>
            <v-chip
              v-if="custodySummary.latest"
              :color="ASSET_STATUS_COLORS[custodySummary.latest.status]"
              size="small"
              variant="tonal"
              class="font-weight-medium"
            >
              {{ $t(`assetStatus.${custodySummary.latest.status}`) }}
            </v-chip>
            <v-chip v-else size="small" variant="tonal">—</v-chip>
            <div class="text-caption text-medium-emphasis mt-2">
              {{ custodySummary.approvedItems }} {{ $t('assets.items') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    </template>

    <v-row>
      <v-col cols="12" md="7">
        <!-- Contract (العقد) -->
        <v-card class="mb-4">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-file-sign" class="me-2" color="primary" />
              {{ $t('contractCard.title') }}
            </v-card-title>
            <template #append>
              <v-chip
                v-if="contractState"
                :color="
                  contractState === 'active'
                    ? 'success'
                    : contractState === 'expired'
                      ? 'error'
                      : 'warning'
                "
                size="small"
                variant="tonal"
              >
                {{ $t(`contractCard.${contractState}`) }}
              </v-chip>
            </template>
          </v-card-item>
          <v-card-text v-if="!employee.contract" class="text-medium-emphasis">
            {{ $t('contractCard.none') }}
          </v-card-text>
          <v-card-text v-else>
            <v-row dense>
              <v-col
                v-for="cell in [
                  {
                    label: $t('contractCard.type'),
                    value: employee.contract.durationMonths ? $t('contractCard.fixedTerm') : null,
                  },
                  {
                    label: $t('contractCard.start'),
                    value: employee.contract.startDate
                      ? new Date(employee.contract.startDate).toLocaleDateString()
                      : null,
                  },
                  {
                    label: $t('contractCard.end'),
                    value: contractEnd ? contractEnd.toLocaleDateString() : null,
                  },
                  {
                    label: $t('contractCard.duration'),
                    value: employee.contract.durationMonths
                      ? $t('contractCard.months', { n: employee.contract.durationMonths })
                      : null,
                  },
                  {
                    label: $t('contractCard.remaining'),
                    value:
                      contractRemainingMonths !== null
                        ? $t('contractCard.months', { n: contractRemainingMonths })
                        : null,
                  },
                  ...(employee.contract.salary != null
                    ? [{ label: $t('contractCard.salary'), value: String(employee.contract.salary) }]
                    : []),
                ]"
                :key="cell.label"
                cols="6"
                sm="4"
                class="info-cell"
              >
                <div class="text-caption text-medium-emphasis">{{ cell.label }}</div>
                <div class="text-body-2 font-weight-medium">{{ cell.value ?? '—' }}</div>
              </v-col>
            </v-row>
            <template v-if="employee.contract.terms">
              <v-btn
                size="small"
                variant="text"
                color="primary"
                :append-icon="showTerms ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                @click="showTerms = !showTerms"
              >
                {{ $t('contractCard.view') }}
              </v-btn>
              <p v-if="showTerms" class="text-body-2 text-medium-emphasis mt-2 mb-0">
                {{ employee.contract.terms }}
              </p>
            </template>
          </v-card-text>
        </v-card>

        <!-- Expiry-tracked documents -->
        <v-card v-if="!isPipeline" class="mb-4">
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
        <v-card v-if="!isPipeline">
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

      <!-- Requests & services + onboarding documents -->
      <v-col cols="12" md="5">
        <v-card v-if="!isPipeline" class="mb-4">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-hand-extended-outline" class="me-2" color="primary" />
              {{ $t('requests.title') }}
            </v-card-title>
          </v-card-item>
          <v-card-text>
            <v-row v-if="auth.hasRole('HR')" dense class="mb-1">
              <v-col v-for="r in REQUEST_TYPES" :key="r.type" cols="6">
                <v-btn
                  block
                  variant="outlined"
                  class="justify-start text-none service-btn"
                  :prepend-icon="r.icon"
                  @click="openRequest(r.type)"
                >
                  {{ $t(`requests.types.${r.type}`) }}
                </v-btn>
              </v-col>
            </v-row>
            <v-divider v-if="auth.hasRole('HR')" class="my-3" />
            <template v-if="employee.requests.length">
              <div class="text-caption text-medium-emphasis mb-1">{{ $t('requests.recent') }}</div>
              <v-list density="compact" class="pa-0">
                <v-list-item v-for="r in employee.requests.slice(0, 5)" :key="r.id" class="px-0">
                  <template #prepend>
                    <v-icon icon="mdi-clipboard-text-clock-outline" size="20" class="me-2" />
                  </template>
                  <v-list-item-title>{{ $t(`requests.types.${r.type}`) }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ new Date(r.createdAt).toLocaleDateString() }} ·
                    {{ $t('requests.by', { name: r.createdBy.name }) }}
                    <template v-if="r.notes"> · {{ r.notes }}</template>
                  </v-list-item-subtitle>
                  <template #append>
                    <v-tooltip location="top" :text="$t('ai.letter')">
                      <template #activator="{ props }">
                        <v-btn
                          v-bind="props"
                          icon="mdi-creation"
                          variant="text"
                          size="small"
                          color="primary"
                          @click="generateLetter(r)"
                        />
                      </template>
                    </v-tooltip>
                  </template>
                </v-list-item>
              </v-list>
            </template>
            <p v-else class="text-medium-emphasis mb-0">{{ $t('requests.empty') }}</p>
          </v-card-text>
        </v-card>

        <!-- Onboarding documents checklist (المستندات) -->
        <v-card v-if="employee.onboardingDocuments.length">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="mdi-folder-account-outline" class="me-2" color="secondary" />
              {{ $t('onboarding.documents') }}
            </v-card-title>
          </v-card-item>
          <v-list density="compact">
            <v-list-item v-for="doc in employee.onboardingDocuments" :key="doc.id">
              <template #prepend>
                <v-icon
                  :icon="doc.uploaded ? 'mdi-file-check' : 'mdi-file-remove-outline'"
                  :color="doc.uploaded ? 'success' : doc.required ? 'error' : 'grey'"
                />
              </template>
              <v-list-item-title>
                {{ doc.label ?? $t(`docTypes.${doc.type}`, doc.type) }}
                <v-chip v-if="!doc.required" size="x-small" variant="tonal" class="ms-1">
                  {{ $t('onboarding.optional') }}
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ doc.uploaded ? $t('onboarding.uploaded') : $t('onboarding.missing') }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="doc.uploaded && auth.hasRole('HR')"
                  icon="mdi-download"
                  variant="text"
                  size="small"
                  @click="downloadOnboardingDoc(doc)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>
      </v-window-item>

      <!-- Timeline tab (السجل الزمني) -->
      <v-window-item value="timeline">
        <v-card :title="$t('profile.timelineTab')">
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
      </v-window-item>
    </v-window>

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
          <v-btn
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-line-scan"
            class="mb-1"
            block
            :loading="busy === 'scan'"
            @click="scanInput?.click()"
          >
            {{ $t('ai.scan') }}
          </v-btn>
          <p class="text-caption text-medium-emphasis mb-4">{{ $t('ai.scanHint') }}</p>
          <input
            ref="scanInput"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            class="d-none"
            @change="onScanPicked"
          />
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

    <!-- Hard delete confirmation (ADMIN) -->
    <v-dialog v-model="deleteDialog" max-width="480">
      <v-card :title="$t('profile.delete')" class="pa-2">
        <v-card-text>
          <v-alert type="error" variant="tonal" class="mb-3">
            {{ $t('profile.deleteWarning') }}
          </v-alert>
          <p class="text-body-2">
            <strong>{{ employee.firstName }} {{ employee.lastName }}</strong>
            <template v-if="employee.employeeNo"> · {{ employee.employeeNo }}</template>
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="error" variant="flat" :loading="busy === 'delete'" @click="removeEmployee">
            {{ $t('profile.deleteConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- AI letter dialog -->
    <v-dialog v-model="letterDialog.show" max-width="720">
      <v-card class="pa-2">
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">
            <v-icon icon="mdi-creation" class="me-2" color="primary" />
            {{ $t('ai.letterTitle') }} — {{ $t(`requests.types.${letterDialog.type}`, letterDialog.type) }}
          </v-card-title>
        </v-card-item>
        <v-card-text>
          <div v-if="letterDialog.loading" class="text-center py-10">
            <v-progress-circular indeterminate color="primary" size="40" />
            <p class="text-medium-emphasis mt-3">{{ $t('ai.generating') }}</p>
          </div>
          <v-textarea
            v-else
            v-model="letterDialog.text"
            auto-grow
            rows="14"
            max-rows="24"
            variant="outlined"
            class="letter-text"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-content-copy"
            :disabled="letterDialog.loading"
            @click="copyLetter"
          >
            {{ $t('ai.copy') }}
          </v-btn>
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-printer"
            :disabled="letterDialog.loading"
            @click="printLetter"
          >
            {{ $t('ai.print') }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="letterDialog.show = false">{{ $t('common.done') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Request-missing-documents dialog (onboarding loop) -->
    <v-dialog v-model="notesDialog" max-width="480">
      <v-card :title="$t('actions.REQUEST_MISSING')" class="pa-2">
        <v-card-text>
          <v-textarea v-model="missingNotes" :label="$t('onboarding.missingNotes')" rows="3" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="notesDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="warning"
            :loading="busy === 'request-missing'"
            @click="
              notesDialog = false;
              runOnboardingAction('request-missing', missingNotes ? { notes: missingNotes } : undefined);
            "
          >
            {{ $t('common.send') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Contract drafting dialog (CONTRACT_CREATION only) -->
    <v-dialog v-model="contractDialog" max-width="560">
      <v-card :title="$t('contractCard.title')" class="pa-2">
        <v-card-text>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="contractForm.salary" :label="$t('contract.salary')" /></v-col>
            <v-col cols="6">
              <v-text-field v-model="contractForm.durationMonths" :label="$t('contract.durationMonths')" type="number" min="1" />
            </v-col>
            <v-col cols="12">
              <v-text-field v-model="contractForm.startDate" :label="$t('contract.startDate')" type="date" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="contractForm.terms" :label="$t('contract.terms')" rows="3" />
            </v-col>
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

    <!-- New request dialog -->
    <v-dialog v-model="requestDialog.show" max-width="440">
      <v-card :title="$t('requests.new')" class="pa-2">
        <v-card-text>
          <v-select
            v-model="requestDialog.type"
            :items="REQUEST_TYPES.map((r) => ({ title: $t(`requests.types.${r.type}`), value: r.type }))"
            :label="$t('requests.title')"
          />
          <v-textarea v-model="requestDialog.notes" :label="$t('requests.notes')" rows="3" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="requestDialog.show = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn color="primary" :loading="busy === 'request'" @click="submitRequest">
            {{ $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Edit profile dialog -->
    <v-dialog v-model="editDialog" max-width="720">
      <v-card :title="$t('profile.edit')" class="pa-2">
        <v-card-text>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.firstName" :label="$t('fields.firstName')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.lastName" :label="$t('fields.lastName')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.email" :label="$t('fields.email')" type="email" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.phone" :label="$t('fields.phone')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.nationalId" :label="$t('fields.nationalId')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.birthDate" :label="$t('fields.birthDate')" type="date" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-combobox
                v-model="editForm.department"
                :items="fieldOptions.departments"
                :label="$t('fields.department')"
                :hint="$t('fields.comboHint')"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.project" :label="$t('employees.project')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-combobox
                v-model="editForm.jobTitle"
                :items="fieldOptions.jobTitles"
                :label="$t('fields.jobTitle')"
                :hint="$t('fields.comboHint')"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.directManager" :label="$t('profile.directManager')" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="editForm.employmentType"
                :items="EMPLOYMENT_TYPES.map((v) => ({ title: $t(`profile.types.${v}`), value: v }))"
                :label="$t('profile.employmentType')"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="editForm.hireDate" :label="$t('employees.hireDate')" type="date" />
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            color="primary"
            :loading="busy === 'edit'"
            :disabled="!editForm.firstName.trim() || !editForm.lastName.trim() || !editForm.email.trim() || !editForm.hireDate"
            @click="saveEdit"
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

.photo-edit-btn {
  position: absolute;
  bottom: -2px;
  inset-inline-end: -2px;
}

.status-panel {
  min-width: 200px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.info-cell {
  padding-block: 8px;
}

.service-btn {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
  font-weight: 500;
}

.letter-text :deep(textarea) {
  font-family: 'Times New Roman', serif;
  line-height: 1.9;
}
</style>
