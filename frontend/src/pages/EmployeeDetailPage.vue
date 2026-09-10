<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, getAccessToken } from '../api/client';
import { useConfirm } from '../composables/useConfirm';
import ProcessCard from '../components/ProcessCard.vue';
import StatusChip from '../components/StatusChip.vue';
import { useAuthStore } from '../stores/auth';

interface ProcessData {
  status: string;
  holdReason?: string | null;
  holdNote?: string | null;
  certificateStorageKey?: string | null;
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

type ContractStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'EXPIRED';

interface ContractSummary {
  startDate: string | null;
  durationMonths: number | null;
  terms: string | null;
  salary?: number | null;
  sentAt: string | null;
  approvedAt: string | null;
  /** Recorded by HR — the contract itself lives on an external platform. */
  status: ContractStatus;
  statusChangedAt: string;
  rejectReason: string | null;
  externalRef: string | null;
  /** Uploaded scan / photo / PDF of the contract, if any. */
  storageKey?: string | null;
}

const CONTRACT_STATUS_COLORS: Record<ContractStatus, string> = {
  DRAFT: 'grey',
  PENDING_APPROVAL: 'amber',
  ACTIVE: 'success',
  REJECTED: 'error',
  EXPIRED: 'error',
};

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
  /** Language of every email this person receives. */
  preferredLanguage: 'AR' | 'EN';
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
  /** Latest page only (newest first) — auditTotal is the full length. */
  auditLogs: AuditRow[];
  auditTotal: number;
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
const confirm = useConfirm();
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
  // The payload carries the newest timeline page; older ones load on demand.
  timelineLogs.value = employee.value.auditLogs;
  timelinePage.value = 1;
  void loadPhoto();
}

// -------------------------------------------------------------- timeline
const timelineLogs = ref<AuditRow[]>([]);
const timelinePage = ref(1);
const timelineBusy = ref(false);
const TIMELINE_PAGE_SIZE = 20;

async function loadMoreTimeline() {
  timelineBusy.value = true;
  try {
    const next = timelinePage.value + 1;
    const res = await api.get<{ items: AuditRow[]; total: number }>(
      `/api/employees/${id}/audit?page=${next}&limit=${TIMELINE_PAGE_SIZE}`,
    );
    timelineLogs.value = [...timelineLogs.value, ...res.items];
    timelinePage.value = next;
    if (employee.value) employee.value.auditTotal = res.total;
  } finally {
    timelineBusy.value = false;
  }
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
const fieldOptions = ref<{ departments: string[]; jobTitles: string[]; projects: string[] }>({
  departments: [],
  jobTitles: [],
  projects: [],
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
  preferredLanguage: 'AR' as 'AR' | 'EN',
  hireDate: '',
});

function openEdit() {
  const e = employee.value;
  if (!e) return;
  void api.get<{ departments: string[]; jobTitles: string[]; projects: string[] }>('/api/employees/options')
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
    preferredLanguage: e.preferredLanguage ?? 'AR',
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
      preferredLanguage: f.preferredLanguage,
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

// Contract actions are NOT here on purpose: they live on the contract card
// as a status change (the contract is approved on an external platform).
const ONBOARDING_ACTIONS: Record<string, { endpoint: string; icon: string; color: string }> = {
  SEND_FORM: { endpoint: 'send-form', icon: 'send', color: 'primary' },
  REQUEST_MISSING: { endpoint: 'request-missing', icon: 'file-warning', color: 'warning' },
  ACCEPT_DOCUMENTS: { endpoint: 'accept-documents', icon: 'file-check', color: 'success' },
  REOPEN: { endpoint: 'reopen', icon: 'rotate-ccw', color: 'secondary' },
};

const isWithdrawn = computed(() => employee.value?.status === 'WITHDRAWN');
/** Someone who has left: no new custody, no new actions. */
const isClosed = computed(
  () => !!employee.value && ['INACTIVE', 'WITHDRAWN'].includes(employee.value.status),
);
const isPipeline = computed(
  () => !!employee.value && !['ACTIVE', 'INACTIVE', 'WITHDRAWN'].includes(employee.value.status),
);

// ------------------------------------------------- contract status (manual)
/** The status changes HR may record right now, derived from the machine. */
const contractStatusOptions = computed(() => {
  const acts = employee.value?.availableActions ?? [];
  const options: Array<{ status: ContractStatus; label: string; hint: string; icon: string; color: string }> = [];
  if (acts.includes('SUBMIT_CONTRACT')) {
    options.push({ status: 'PENDING_APPROVAL', label: t('contract.submit'), hint: t('contract.submitHint'), icon: 'send', color: 'primary' });
  }
  if (acts.includes('APPROVE_CONTRACT')) {
    options.push({ status: 'ACTIVE', label: t('contract.approve'), hint: t('contract.approveHint'), icon: 'badge-check', color: 'success' });
  }
  if (acts.includes('REJECT_CONTRACT')) {
    options.push({ status: 'REJECTED', label: t('contract.reject'), hint: t('contract.rejectHint'), icon: 'octagon-x', color: 'error' });
  }
  if (acts.includes('EXPIRE')) {
    options.push({ status: 'EXPIRED', label: t('contract.expire'), hint: t('contract.expireHint'), icon: 'timer-off', color: 'warning' });
  }
  return options;
});

const rejectDialog = ref(false);
const rejectReason = ref('');

async function onContractStatus(status: ContractStatus) {
  const name = `${employee.value?.firstName ?? ''} ${employee.value?.lastName ?? ''}`.trim();
  if (status === 'REJECTED') {
    rejectReason.value = '';
    rejectDialog.value = true;
    return;
  }
  if (status === 'ACTIVE' && !(await confirm({ title: t('contract.approve'), message: t('contract.approveConfirm', { name }), color: 'success', confirmText: t('contract.approve') }))) return;
  if (status === 'EXPIRED' && !(await confirm({ title: t('contract.expire'), message: t('contract.expireConfirm'), color: 'warning', confirmText: t('contract.expire') }))) return;
  void setContractStatus(status);
}

async function setContractStatus(status: ContractStatus, reason?: string) {
  busy.value = 'contract-status';
  try {
    await api.put(`/api/employees/${id}/contract/status`, { status, ...(reason ? { reason } : {}) });
    rejectDialog.value = false;
    const name = `${employee.value?.firstName ?? ''} ${employee.value?.lastName ?? ''}`.trim();
    notify(status === 'ACTIVE' ? t('contract.activated', { name }) : t('contract.statusChanged'));
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

// ------------------------------------------------------------ withdrawal
const withdrawDialog = ref(false);
const withdrawReason = ref('');

async function withdrawEmployee() {
  busy.value = 'withdraw';
  try {
    const result = await api.post<{ halted: { links: number; assetForms: number; processes: string[] } | null }>(
      `/api/employees/${id}/withdraw`,
      { reason: withdrawReason.value.trim() },
    );
    withdrawDialog.value = false;
    const h = result.halted;
    notify(
      h
        ? `${t('withdraw.done')} ${t('withdraw.stopped', { links: h.links, forms: h.assetForms, processes: h.processes.length })}`
        : t('withdraw.done'),
    );
    await load();
  } catch (e) {
    notify(e instanceof ApiError ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

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

// ------------------------------------------------------- document viewer
// Clicking a document previews it (PDF/image render in a dialog); download
// is a button inside the viewer rather than the click's side effect.
const viewer = ref<{
  show: boolean;
  title: string;
  url: string;
  kind: 'pdf' | 'image' | 'other';
  downloadName: string;
}>({ show: false, title: '', url: '', kind: 'other', downloadName: '' });

async function openViewer(fetchUrl: string, title: string, downloadName: string) {
  const res = await fetch(fetchUrl, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) {
    notify(t('common.error'), 'error');
    return;
  }
  const blob = await res.blob();
  if (viewer.value.url) URL.revokeObjectURL(viewer.value.url);
  const kind = blob.type.includes('pdf')
    ? 'pdf'
    : blob.type.startsWith('image/')
      ? 'image'
      : 'other';
  viewer.value = {
    show: true,
    title,
    url: URL.createObjectURL(blob),
    kind,
    downloadName,
  };
}

function downloadFromViewer() {
  const a = document.createElement('a');
  a.href = viewer.value.url;
  a.download = viewer.value.downloadName;
  a.click();
}

function closeViewer() {
  if (viewer.value.url) URL.revokeObjectURL(viewer.value.url);
  viewer.value = { show: false, title: '', url: '', kind: 'other', downloadName: '' };
}

/** HR reviews an uploaded checklist file — view first, download inside. */
function viewOnboardingDoc(doc: OnboardingDoc) {
  const title = doc.label ?? t(`docTypes.${doc.type}`, doc.type);
  void openViewer(
    `/api/employees/${id}/onboarding-documents/${doc.id}/download`,
    title,
    title,
  );
}

/** A process's completion document (GOSI / medical / criminal). */
function viewProcessDoc(kind: 'gosi' | 'medical' | 'criminal', title: string) {
  void openViewer(`/api/employees/${id}/processes/${kind}/certificate`, title, title);
}

/** Attaching the completion document IS the COMPLETE action. */
async function attachProcessDoc(kind: 'gosi' | 'medical' | 'criminal', file: File) {
  busy.value = kind;
  try {
    const body = new FormData();
    body.append('certificate', file);
    const res = await fetch(`/api/employees/${id}/processes/${kind}/certificate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      body,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(data?.error?.message ?? t('common.error'));
    }
    notify(t('common.done'));
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

// Contract drafting (CONTRACT_CREATION only)
const contractDialog = ref(false);
const contractForm = ref({ salary: '', durationMonths: '', startDate: '', terms: '' });
const contractExternalRef = ref('');
const contractFile = ref<File | null>(null);
const contractFileInput = ref<HTMLInputElement | null>(null);

function onContractFilePicked(event: Event) {
  contractFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

function viewContractFile() {
  void openViewer(`/api/employees/${id}/contract/file`, t('contractCard.title'), t('contractCard.title'));
}

/** Uploads the picked document; the typed terms stay optional. */
async function uploadContractFile(file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/employees/${id}/contract/file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    body,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(data?.error?.message ?? t('common.error'));
  }
}

function openContractDialog() {
  const c = employee.value?.contract;
  contractForm.value = {
    salary: c?.salary != null ? String(c.salary) : '',
    durationMonths: c?.durationMonths != null ? String(c.durationMonths) : '',
    startDate: typeof c?.startDate === 'string' ? c.startDate.slice(0, 10) : '',
    terms: c?.terms ?? '',
  };
  contractExternalRef.value = c?.externalRef ?? '';
  contractFile.value = null;
  contractDialog.value = true;
}

async function saveContract() {
  busy.value = 'contract';
  try {
    if (contractFile.value) await uploadContractFile(contractFile.value);
    const details: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(contractForm.value)) if (v.trim()) details[k] = v.trim();
    await api.put(`/api/employees/${id}/contract`, {
      details,
      externalRef: contractExternalRef.value.trim() || null,
    });
    contractDialog.value = false;
    notify(t('common.saved'));
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : t('common.error'), 'error');
  } finally {
    busy.value = '';
  }
}

// ------------------------------------------------------------- requests & services
const REQUEST_TYPES = [
  { type: 'SALARY_LETTER', icon: 'file-user' },
  { type: 'BANK_LETTER', icon: 'landmark' },
  { type: 'DEPARTMENT_CHANGE', icon: 'network' },
  { type: 'JOB_TITLE_CHANGE', icon: 'user-check' },
  { type: 'PROMOTION', icon: 'circle-arrow-up' },
  { type: 'PROJECT_TRANSFER', icon: 'arrow-left-right' },
  { type: 'WARNING', icon: 'triangle-alert' },
  { type: 'INVESTIGATION', icon: 'search' },
];

/** type → icon lookup for the recent-requests log and dialogs. */
const REQUEST_ICON: Record<string, string> = Object.fromEntries(
  REQUEST_TYPES.map((r) => [r.type, r.icon]),
);

/** Expiry-tracked document types get a recognizable icon each. */
const DOC_ICON: Record<string, string> = {
  IQAMA: 'id-card',
  NATIONAL_ID: 'id-card',
  PASSPORT: 'book-user',
  CONTRACT: 'file-signature',
  WORK_PERMIT: 'briefcase',
  DRIVING_LICENSE: 'car',
};

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

// ------------------------------------------------------------- print profile
function printProfile() {
  if (!employee.value) return;
  const e = employee.value;
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return;
  const dir = locale.value.startsWith('ar') ? 'rtl' : 'ltr';
  const esc = (v: unknown) =>
    String(v ?? '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const rows: Array<[string, unknown]> = [
    [t('employees.no'), e.employeeNo],
    [t('fields.name'), `${e.firstName} ${e.lastName}`],
    [t('fields.jobTitle'), e.jobTitle],
    [t('fields.department'), e.department],
    [t('employees.project'), e.project],
    [t('fields.status'), t(`employees.statuses.${e.status}`)],
    [t('fields.nationalId'), e.nationalId],
    [t('fields.birthDate'), e.birthDate ? new Date(e.birthDate).toLocaleDateString() : null],
    [t('fields.phone'), e.phone],
    [t('fields.email'), e.email],
    [t('employees.hireDate'), e.hireDate ? new Date(e.hireDate).toLocaleDateString() : null],
    [
      t('profile.employmentType'),
      e.employmentType ? t(`profile.types.${e.employmentType}`) : null,
    ],
    [t('profile.directManager'), e.directManager],
  ];
  const table = rows
    .map(
      ([label, v]) => `<tr>
        <td style="padding:8px 12px;border:1px solid #bbb;background:#f4f4f4;width:35%;font-weight:600;">${esc(label)}</td>
        <td style="padding:8px 12px;border:1px solid #bbb;">${esc(v)}</td>
      </tr>`,
    )
    .join('');
  w.document.write(
    `<div style="font-family:'Segoe UI',Tahoma,sans-serif;direction:${dir};padding:40px;">
      <h2 style="margin:0 0 4px;">${esc(`${e.firstName} ${e.lastName}`)}</h2>
      <div style="color:#666;margin-bottom:24px;">
        ${e.employeeNo ? `${esc(e.employeeNo)} · ` : ''}${esc(e.jobTitle ?? '')}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${table}</table>
      <div style="margin-top:28px;color:#888;font-size:12px;">${esc(new Date().toLocaleString())}</div>
    </div>`,
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


// ------------------------------------------------------------- header actions
/**
 * Everything HR can do from the header, in one list. The most consequential
 * legal action for the current status becomes the single primary button;
 * the rest sit in the Actions menu with the destructive ones at the bottom.
 */
interface HeaderAction {
  key: string;
  label: string;
  icon: string;
  color?: string;
  busyKey?: string;
  disabled?: boolean;
  destructive?: boolean;
  divider?: boolean;
  run: () => void;
}

const allActions = computed<HeaderAction[]>(() => {
  const e = employee.value;
  if (!e) return [];
  const out: HeaderAction[] = [];
  for (const o of contractStatusOptions.value) {
    out.push({
      key: `contract:${o.status}`,
      label: o.label,
      icon: o.icon,
      color: o.color,
      busyKey: 'contract-status',
      disabled: o.status === 'PENDING_APPROVAL' && !e.contract,
      run: () => void onContractStatus(o.status),
    });
  }
  for (const b of onboardingButtons.value) {
    out.push({
      key: `onb:${b.action}`,
      label: t(`actions.${b.action}`),
      icon: b.icon,
      color: b.color,
      busyKey: b.endpoint,
      run: () => onOnboardingAction(b.action),
    });
  }
  if (isPipeline.value && e.status === 'CONTRACT_CREATION' && auth.hasRole('HR')) {
    out.push({
      key: 'contract-edit',
      label: e.contract ? t('contract.edit') : t('contract.createBtn'),
      icon: 'file-pen-line',
      color: 'primary',
      run: openContractDialog,
    });
  }
  if (auth.hasRole('IT') && !isClosed.value) {
    out.push({ key: 'asset', label: t('assets.newForm'), icon: 'laptop', run: () => { formDialog.value = true; } });
  }
  if (!isPipeline.value && !isClosed.value && auth.hasRole('HR')) {
    out.push({ key: 'doc', label: t('expiryDocs.add'), icon: 'file-clock', run: () => openDocDialog() });
    out.push({ key: 'req', label: t('requests.new'), icon: 'hand', run: () => openRequest('SALARY_LETTER') });
  }
  if (auth.hasRole('HR')) out.push({ key: 'edit', label: t('profile.edit'), icon: 'pencil', run: openEdit });
  out.push({ key: 'print', label: t('common.print'), icon: 'printer', run: printProfile });

  const danger: HeaderAction[] = [];
  if (!openOffboarding.value && e.status === 'ACTIVE' && auth.hasRole('HR')) {
    danger.push({ key: 'offboard', label: t('profile.endContract'), icon: 'log-out', destructive: true, run: () => { offboardingDialog.value = true; } });
  }
  if (e.availableActions.includes('WITHDRAW')) {
    danger.push({ key: 'withdraw', label: t('withdraw.button'), icon: 'user-x', destructive: true, run: () => { withdrawReason.value = ''; withdrawDialog.value = true; } });
  }
  if (auth.user?.role === 'ADMIN') {
    danger.push({ key: 'delete', label: t('profile.delete'), icon: 'trash-2', destructive: true, run: () => { deleteDialog.value = true; } });
  }
  if (danger.length) out.push({ key: 'sep', label: '', icon: '', divider: true, run: () => {} }, ...danger);
  return out;
});

const primaryAction = computed<HeaderAction | null>(() => {
  const a = allActions.value;
  return (
    a.find((x) => x.key === 'contract:ACTIVE') ??
    a.find((x) => x.key.startsWith('contract:') || x.key.startsWith('onb:')) ??
    a.find((x) => x.key === 'contract-edit') ??
    null
  );
});
const menuActions = computed(() => allActions.value.filter((a) => a.key !== primaryAction.value?.key));

onMounted(load);
</script>

<template>
  <v-container v-if="employee" class="py-8" style="max-width: 1200px">
    <!-- Header -->
    <div class="d-flex align-center mb-4" style="gap: 8px">
      <v-btn icon="arrow-left" variant="text" to="/employees" class="flip-rtl" />
      <span class="text-medium-emphasis text-body-2">
        {{ $t('employees.title') }} / {{ employee.firstName }} {{ employee.lastName }}
      </span>
    </div>

    <!-- Profile header: identity, one primary action, everything else in a menu -->
    <v-card class="mb-4 profile-head">
      <div class="profile-head__main">
        <div class="position-relative flex-shrink-0">
          <v-avatar size="72" color="primary" variant="tonal" rounded="xl">
            <v-img v-if="photoUrl" :src="photoUrl" cover />
            <span v-else class="text-h5 font-weight-bold">{{ initials }}</span>
          </v-avatar>
          <v-btn
            v-if="auth.hasRole('HR')"
            icon="camera"
            size="x-small"
            color="primary"
            class="photo-edit-btn"
            :loading="busy === 'photo'"
            :aria-label="$t('profile.uploadPhoto')"
            @click="photoInput?.click()"
          />
          <input ref="photoInput" type="file" accept="image/jpeg,image/png" class="d-none" @change="onPhotoPicked" />
        </div>

        <div class="flex-grow-1 min-w-0">
          <div class="d-flex align-center flex-wrap ga-2">
            <h1 class="text-h5 font-weight-bold">{{ employee.firstName }} {{ employee.lastName }}</h1>
            <StatusChip :status="employee.status" />
          </div>
          <div class="text-body-2 text-medium-emphasis mt-1">
            {{ [employee.jobTitle, employee.department, employee.project].filter(Boolean).join(' · ') || '—' }}
          </div>
          <div class="profile-head__meta text-caption text-medium-emphasis mt-2">
            <span v-if="employee.employeeNo" class="tnum"><v-icon icon="hash" size="12" />{{ employee.employeeNo }}</span>
            <span dir="ltr"><v-icon icon="mail" size="12" />{{ employee.email }}</span>
            <span v-if="employee.phone" dir="ltr"><v-icon icon="phone" size="12" />{{ employee.phone }}</span>
            <span v-if="employee.hireDate"><v-icon icon="calendar-check" size="12" />{{ new Date(employee.hireDate).toLocaleDateString() }}</span>
            <span v-if="isPipeline" :class="missingCount === 0 ? 'text-success' : 'text-warning'">
              <v-icon :icon="missingCount === 0 ? 'circle-check' : 'circle-alert'" size="12" />
              {{ missingCount === 0 ? $t('profile.dataComplete') : $t('profile.dataMissing', { n: missingCount }) }}
            </span>
          </div>
        </div>

        <div class="profile-head__actions">
          <v-btn
            v-if="primaryAction"
            :color="primaryAction.color ?? 'primary'"
            variant="flat"
            :prepend-icon="primaryAction.icon"
            :loading="!!primaryAction.busyKey && busy === primaryAction.busyKey"
            :disabled="primaryAction.disabled"
            @click="primaryAction.run()"
          >
            {{ primaryAction.label }}
          </v-btn>
          <v-menu v-if="menuActions.length">
            <template #activator="{ props }">
              <v-btn v-bind="props" variant="tonal" append-icon="chevron-down">{{ $t('profile.actionsMenu') }}</v-btn>
            </template>
            <v-list density="compact" min-width="260">
              <template v-for="item in menuActions" :key="item.key">
                <v-divider v-if="item.divider" class="my-1" />
                <v-list-item
                  v-else
                  :prepend-icon="item.icon"
                  :title="item.label"
                  :base-color="item.destructive ? 'error' : undefined"
                  :disabled="item.disabled"
                  @click="item.run()"
                />
              </template>
            </v-list>
          </v-menu>
        </div>
      </div>

      <!-- Where the hire stands: done · current · next -->
      <div v-if="isPipeline || isWithdrawn" class="profile-head__steps">
        <template v-for="(stage, i) in PIPELINE_STAGES" :key="stage">
          <span
            class="step"
            :class="{ 'step--done': PIPELINE_STAGES.indexOf(employee.status) > i, 'step--now': stage === employee.status }"
          >
            <v-icon v-if="PIPELINE_STAGES.indexOf(employee.status) > i" icon="check" size="12" />
            <span v-else class="step__dot" />
            {{ $t(`status.${stage}`) }}
          </span>
          <v-icon icon="chevron-right" size="14" class="step__sep flip-rtl" />
        </template>
        <span class="step"><span class="step__dot" />{{ $t('status.ACTIVE') }}</span>
        <v-chip v-if="isWithdrawn" size="x-small" color="error" class="ms-2">{{ $t('status.WITHDRAWN') }}</v-chip>
      </div>
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
      <v-tab value="overview" prepend-icon="layout-dashboard">
        {{ $t('profile.overview') }}
      </v-tab>
      <v-tab value="timeline" prepend-icon="history">
        {{ $t('profile.timelineTab') }}
      </v-tab>
    </v-tabs>

    <v-window v-model="tab" :touch="false">
      <v-window-item value="overview">
        <!-- Details (البيانات) -->
        <v-card class="mb-4">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="id-card" class="me-2" color="primary" />
              {{ $t('profile.details') }}
            </v-card-title>
          </v-card-item>
          <v-card-text>
            <v-row dense>
              <v-col
                v-for="field in [
                  { icon: 'hash', label: $t('employees.no'), value: employee.employeeNo },
                  { icon: 'network', label: $t('fields.department'), value: employee.department },
                  { icon: 'briefcase', label: $t('employees.project'), value: employee.project },
                  { icon: 'id-card', label: $t('fields.nationalId'), value: employee.nationalId },
                  {
                    icon: 'cake',
                    label: $t('fields.birthDate'),
                    value: employee.birthDate ? new Date(employee.birthDate).toLocaleDateString() : null,
                  },
                  { icon: 'phone', label: $t('fields.phone'), value: employee.phone },
                  { icon: 'mail', label: $t('fields.email'), value: employee.email },
                  {
                    icon: 'calendar-check',
                    label: $t('employees.hireDate'),
                    value: employee.hireDate ? new Date(employee.hireDate).toLocaleDateString() : null,
                  },
                  {
                    icon: 'briefcase-business',
                    label: $t('profile.employmentType'),
                    value: $t(`profile.types.${employee.employmentType}`),
                  },
                  { icon: 'user-round', label: $t('profile.directManager'), value: employee.directManager },
                  { icon: 'languages', label: $t('fields.preferredLanguage'), value: $t(`languages.${employee.preferredLanguage ?? 'AR'}`) },
                ]"
                :key="field.label"
                cols="6"
                sm="4"
                md="3"
                class="info-cell"
              >
                <div class="text-caption text-medium-emphasis">
                  <v-icon :icon="field.icon" size="14" class="me-1" />{{ field.label }}
                </div>
                <div class="text-body-2 font-weight-medium">{{ field.value ?? '—' }}</div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>

    <!-- Onboarding pipeline progress (pre-activation) -->
    <v-card v-if="isPipeline || isWithdrawn" class="mb-6">
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">
          <v-icon icon="graduation-cap" class="me-2" color="primary" />
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
                PIPELINE_STAGES.indexOf(employee.status) > i ? 'check' : undefined
              "
            >
              {{ $t(`status.${stage}`) }}
            </v-chip>
            <v-icon
              v-if="i < PIPELINE_STAGES.length - 1"
              icon="chevron-right"
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
        <v-alert
          v-if="isWithdrawn"
          type="warning"
          variant="tonal"
          density="compact"
          icon="user-x"
          class="mt-2 mb-0"
        >
          {{ $t('withdraw.banner') }}
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- BRD Stage 2: the independent processes (عمليات الموظف) -->
    <template v-if="!isPipeline && !isWithdrawn">
    <h2 class="text-subtitle-1 font-weight-bold mb-3">{{ $t('profile.processes') }}</h2>
    <v-row class="mb-2">
      <v-col cols="12" sm="6" md="3">
        <ProcessCard
          :title="$t('processes.gosi')"
          icon="shield-check"
          :process="employee.gosi"
          :actions="employee.processActions.gosi"
          :hold-reasons="GOSI_REASONS"
          :busy="busy === 'gosi'"
          @act="(a, p) => actOnProcess('gosi', a, p)"
          @attach="(f) => attachProcessDoc('gosi', f)"
          @view-document="viewProcessDoc('gosi', $t('processes.gosi'))"
        />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <ProcessCard
          :title="$t('processes.medical')"
          icon="cross"
          :process="employee.medical"
          :actions="employee.processActions.medical"
          :hold-reasons="MEDICAL_REASONS"
          :busy="busy === 'medical'"
          @act="(a, p) => actOnProcess('medical', a, p)"
          @attach="(f) => attachProcessDoc('medical', f)"
          @view-document="viewProcessDoc('medical', $t('processes.medical'))"
        />
      </v-col>
      <v-col cols="12" sm="6" md="3">
        <ProcessCard
          :title="$t('processes.criminal')"
          icon="file-badge"
          :process="employee.criminalRecord"
          :actions="employee.processActions.criminal"
          :hold-reasons="[]"
          :busy="busy === 'criminal'"
          @act="(a) => actOnProcess('criminal', a)"
          @attach="(f) => attachProcessDoc('criminal', f)"
          @view-document="viewProcessDoc('criminal', $t('processes.criminal'))"
        />
      </v-col>
      <!-- Custody at a glance (إدارة العهد) -->
      <v-col cols="12" sm="6" md="3">
        <v-card class="h-100">
          <v-card-text class="text-center py-5">
            <v-icon icon="package" size="36" color="deep-purple" class="mb-2" />
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
              <v-icon icon="file-signature" class="me-2" color="primary" />
              {{ $t('contractCard.title') }}
            </v-card-title>
            <template #append>
              <v-chip
                v-if="employee.contract"
                :color="CONTRACT_STATUS_COLORS[employee.contract.status]"
                size="small"
                variant="tonal"
                class="font-weight-medium"
              >
                {{ $t(`contractStatus.${employee.contract.status}`) }}
                <template v-if="employee.contract.status === 'ACTIVE' && contractState === 'expired'">
                  · {{ $t('contractCard.expired') }}
                </template>
              </v-chip>
            </template>
          </v-card-item>
          <v-card-text v-if="!employee.contract" class="text-medium-emphasis">
            {{ $t('contractCard.none') }}
          </v-card-text>
          <v-card-text v-else>
            <p v-if="isPipeline" class="text-caption text-medium-emphasis mb-3">
              {{ $t('contract.statusHint') }}
            </p>
            <v-alert
              v-if="employee.contract.status === 'REJECTED'"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-3"
            >
              {{ $t('contract.rejectedBanner') }}
              <div v-if="employee.contract.rejectReason" class="text-body-2 mt-1">
                {{ $t('contract.rejectReason') }}: {{ employee.contract.rejectReason }}
              </div>
            </v-alert>
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
                  { label: $t('contract.externalRef'), value: employee.contract.externalRef },
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
            <v-btn
              v-if="employee.contract.storageKey"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="file-signature"
              class="me-2"
              @click="viewContractFile"
            >
              {{ $t('contract.viewFile') }}
            </v-btn>
            <template v-if="employee.contract.terms">
              <v-btn
                size="small"
                variant="text"
                color="primary"
                :append-icon="showTerms ? 'chevron-up' : 'chevron-down'"
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
              <v-icon icon="id-card" class="me-2" color="primary" />
              {{ $t('expiryDocs.title') }}
            </v-card-title>
            <template #append>
              <v-btn
                v-if="auth.hasRole('HR')"
                color="primary"
                size="small"
                prepend-icon="plus"
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
                <v-icon :icon="DOC_ICON[doc.type] ?? 'file-clock'" :color="docColor(doc)" />
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
                  icon="pencil"
                  variant="text"
                  size="small"
                  @click="openDocDialog(doc)"
                />
                <v-btn
                  v-if="auth.hasRole('HR')"
                  icon="trash-2"
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
        <!-- Custody (العهد): available from the trainee stage; the same rows
             follow the person into the employee file on conversion. -->
        <v-card>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">
              <v-icon icon="laptop" class="me-2" color="secondary" />
              {{ $t('assets.title') }}
            </v-card-title>
            <template #append>
              <v-btn
                v-if="auth.hasRole('IT') && !isClosed"
                color="primary"
                size="small"
                prepend-icon="plus"
                @click="formDialog = true"
              >
                {{ $t('assets.newForm') }}
              </v-btn>
            </template>
          </v-card-item>

          <v-card-text v-if="employee.assetForms.length === 0" class="text-medium-emphasis">
            {{ $t('assets.empty') }}
            <div v-if="isPipeline" class="text-caption mt-1">{{ $t('assets.trainee') }}</div>
            <div v-else-if="isClosed" class="text-caption mt-1">{{ $t('assets.closed') }}</div>
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
              <v-icon icon="hand" class="me-2" color="primary" />
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
                    <v-icon
                      :icon="REQUEST_ICON[r.type] ?? 'clipboard-clock'"
                      size="20"
                      class="me-2"
                      color="primary"
                    />
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
                          icon="sparkles"
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
              <v-icon icon="folder" class="me-2" color="secondary" />
              {{ $t('onboarding.documents') }}
            </v-card-title>
          </v-card-item>
          <!-- Inline checklist: chip per document, click to download when uploaded -->
          <v-card-text class="d-flex flex-wrap pt-0" style="gap: 8px">
            <v-tooltip
              v-for="doc in employee.onboardingDocuments"
              :key="doc.id"
              location="top"
              :text="doc.uploaded ? $t('onboarding.uploaded') : $t('onboarding.missing')"
            >
              <template #activator="{ props }">
                <v-chip
                  v-bind="props"
                  :prepend-icon="doc.uploaded ? 'file-check' : 'file-x'"
                  :color="doc.uploaded ? 'success' : doc.required ? 'error' : 'grey'"
                  variant="tonal"
                  :append-icon="doc.uploaded && auth.hasRole('HR') ? 'eye' : undefined"
                  @click="doc.uploaded && auth.hasRole('HR') && viewOnboardingDoc(doc)"
                >
                  {{ doc.label ?? $t(`docTypes.${doc.type}`, doc.type) }}
                  <span v-if="!doc.required" class="text-caption ms-1">
                    ({{ $t('onboarding.optional') }})
                  </span>
                </v-chip>
              </template>
            </v-tooltip>
          </v-card-text>
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
                v-for="log in timelineLogs"
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
            <div v-if="timelineLogs.length < employee.auditTotal" class="text-center mt-2">
              <v-btn
                variant="tonal"
                size="small"
                :loading="timelineBusy"
                prepend-icon="history"
                @click="loadMoreTimeline"
              >
                {{ $t('profile.timelineMore') }} ({{ employee.auditTotal - timelineLogs.length }})
              </v-btn>
            </div>
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
                  icon="trash-2"
                  variant="text"
                  size="small"
                  color="error"
                  :disabled="newForm.items.length === 1"
                  @click="newForm.items.splice(i, 1)"
                />
              </v-col>
            </v-row>
          </div>
          <v-btn variant="tonal" size="small" prepend-icon="plus" @click="newForm.items.push(emptyItem())">
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

    <!-- Contract rejected on the platform: record the reason -->
    <v-dialog v-model="rejectDialog" max-width="480">
      <v-card>
        <div class="px-6 pt-6 pb-2">
          <h2 class="text-subtitle-1 font-weight-bold">{{ $t('contract.rejectTitle') }}</h2>
          <p class="text-caption text-medium-emphasis mb-0">{{ $t('contract.rejectHint') }}</p>
        </div>
        <v-card-text class="pt-4">
          <v-textarea v-model="rejectReason" :label="$t('contract.rejectReason')" rows="3" auto-grow />
        </v-card-text>
        <v-card-actions class="px-6 pb-5 pt-2">
          <v-spacer />
          <v-btn variant="text" @click="rejectDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            variant="flat"
            color="error"
            class="px-5"
            :loading="busy === 'contract-status'"
            @click="setContractStatus('REJECTED', rejectReason.trim() || undefined)"
          >
            {{ $t('contract.reject') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Withdrawal: terminal for a trainee; stops every open item, deletes nothing -->
    <v-dialog v-model="withdrawDialog" max-width="520">
      <v-card>
        <div class="d-flex align-center ga-3 px-6 pt-6 pb-2">
          <v-avatar color="error" variant="tonal" size="42" rounded="lg">
            <v-icon icon="user-x" size="22" />
          </v-avatar>
          <div>
            <h2 class="text-subtitle-1 font-weight-bold">{{ $t('withdraw.title') }}</h2>
            <p class="text-caption text-medium-emphasis mb-0">
              {{ employee.firstName }} {{ employee.lastName }}
            </p>
          </div>
        </div>
        <v-card-text class="pt-4">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
            {{ $t('withdraw.hint') }}
          </v-alert>
          <v-textarea v-model="withdrawReason" :label="$t('withdraw.reason')" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions class="px-6 pb-5 pt-2">
          <v-spacer />
          <v-btn variant="text" @click="withdrawDialog = false">{{ $t('common.cancel') }}</v-btn>
          <v-btn
            variant="flat"
            color="error"
            class="px-5"
            :loading="busy === 'withdraw'"
            :disabled="!withdrawReason.trim()"
            @click="withdrawEmployee"
          >
            {{ $t('withdraw.confirm') }}
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
            prepend-icon="scan-line"
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
              ...DOC_TYPES.map((type) => ({
                title: $t(`expiryDocs.types.${type}`),
                value: type,
                props: { prependIcon: DOC_ICON[type] },
              })),
              {
                title: $t('expiryDocs.types.CUSTOM'),
                value: 'CUSTOM',
                props: { prependIcon: 'file-question' },
              },
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
            <v-icon icon="sparkles" class="me-2" color="primary" />
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
            prepend-icon="copy"
            :disabled="letterDialog.loading"
            @click="copyLetter"
          >
            {{ $t('ai.copy') }}
          </v-btn>
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="printer"
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
          <p class="text-caption text-medium-emphasis mt-0 mb-4">{{ $t('contract.optionalHint') }}</p>
          <div class="contract-file mb-4">
            <div class="d-flex align-center ga-3 flex-wrap">
              <v-icon icon="file-signature" color="primary" />
              <div class="flex-grow-1 min-w-0">
                <div class="text-body-2 font-weight-medium">{{ $t('contract.file') }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ contractFile ? contractFile.name : employee?.contract?.storageKey ? $t('contract.fileOnFile') : $t('contract.fileHint') }}
                </div>
              </div>
              <v-btn
                v-if="employee?.contract?.storageKey && !contractFile"
                size="small"
                variant="text"
                prepend-icon="eye"
                @click="viewContractFile"
              >
                {{ $t('contract.viewFile') }}
              </v-btn>
              <v-btn size="small" variant="tonal" prepend-icon="upload" @click="contractFileInput?.click()">
                {{ employee?.contract?.storageKey || contractFile ? $t('contract.replaceFile') : $t('contract.chooseFile') }}
              </v-btn>
              <input
                ref="contractFileInput"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                class="d-none"
                @change="onContractFilePicked"
              />
            </div>
          </div>
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
              <v-text-field
                v-model="contractExternalRef"
                :label="$t('contract.externalRef')"
                :hint="$t('contract.externalRefHint')"
                persistent-hint
                dir="ltr"
              />
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
            :items="
              REQUEST_TYPES.map((r) => ({
                title: $t(`requests.types.${r.type}`),
                value: r.type,
                props: { prependIcon: r.icon },
              }))
            "
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
              <v-combobox
                v-model="editForm.project"
                :items="fieldOptions.projects"
                :label="$t('employees.project')"
                :hint="$t('fields.comboHint')"
                persistent-hint
                clearable
              />
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
            <v-col cols="12" sm="6">
              <v-select
                v-model="editForm.preferredLanguage"
                :items="[{ title: $t('languages.AR'), value: 'AR' }, { title: $t('languages.EN'), value: 'EN' }]"
                :label="$t('fields.preferredLanguage')"
                :hint="$t('fields.preferredLanguageHint')"
                persistent-hint
                prepend-inner-icon="languages"
              />
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
          <v-alert type="info" variant="tonal" density="compact" class="mb-3">
            {{ $t('offboarding.stopsOpenWork') }}
          </v-alert>
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

    <!-- Document viewer: preview first, download as an explicit choice. -->
    <v-dialog
      :model-value="viewer.show"
      max-width="860"
      @update:model-value="closeViewer"
    >
      <v-card>
        <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
          {{ viewer.title }}
          <v-spacer />
          <v-btn
            prepend-icon="download"
            variant="tonal"
            size="small"
            color="primary"
            class="me-2"
            @click="downloadFromViewer"
          >
            {{ $t('common.download') }}
          </v-btn>
          <v-btn icon="x" variant="text" size="small" @click="closeViewer" />
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-0" style="height: 70vh">
          <iframe
            v-if="viewer.kind === 'pdf'"
            :src="viewer.url"
            style="width: 100%; height: 100%; border: 0"
            :title="viewer.title"
          />
          <div
            v-else-if="viewer.kind === 'image'"
            class="d-flex align-center justify-center h-100 pa-4"
          >
            <img
              :src="viewer.url"
              :alt="viewer.title"
              style="max-width: 100%; max-height: 100%; object-fit: contain"
            />
          </div>
          <div v-else class="d-flex flex-column align-center justify-center h-100 pa-8">
            <v-icon icon="file-text" size="56" class="mb-4 text-medium-emphasis" />
            <p class="text-medium-emphasis text-center mb-4">
              {{ $t('employees.previewUnavailable') }}
            </p>
            <v-btn color="primary" prepend-icon="download" @click="downloadFromViewer">
              {{ $t('common.download') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
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

/* ── profile header ─────────────────────────────────────────────────────── */
.profile-head { padding: 18px 20px 14px; }
.profile-head__main { display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap; }
.profile-head__meta { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.profile-head__meta > span { display: inline-flex; align-items: center; gap: 5px; }
.profile-head__actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.profile-head__steps {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.step {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 500;
  background: rgb(var(--v-theme-surface-variant));
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.step__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .6; }
.step--done { color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success), 0.12); }
.step--now { color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), 0.12); font-weight: 600; }
.step--now .step__dot { opacity: 1; }
.step__sep { color: rgba(var(--v-theme-on-surface), 0.35); }
@media (max-width: 700px) {
  .profile-head__actions { width: 100%; }
  .profile-head__actions .v-btn:first-child { flex: 1; }
}
.contract-file {
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 12px;
  padding: 12px 14px;
}
</style>
