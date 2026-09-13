/**
 * What an admin can put in a template, and what each built-in template is for.
 * The renderer only substitutes names listed here — a typo in a template
 * renders as an empty string, never as raw user input.
 */

export interface PlaceholderMeta {
  /** Human label per language. */
  ar: string;
  en: string;
  /** Sample used by the preview. */
  sample: { ar: string; en: string };
}

export const PLACEHOLDERS: Record<string, PlaceholderMeta> = {
  name: { ar: 'اسم الموظف', en: 'Employee name', sample: { ar: 'نورة خالد', en: 'Nora Khalid' } },
  employeeNo: { ar: 'الرقم الوظيفي', en: 'Employee number', sample: { ar: 'EMP-0042', en: 'EMP-0042' } },
  department: { ar: 'الإدارة', en: 'Department', sample: { ar: 'تقنية المعلومات', en: 'IT' } },
  jobTitle: { ar: 'المسمى الوظيفي', en: 'Job title', sample: { ar: 'مهندس برمجيات', en: 'Software Engineer' } },
  status: { ar: 'الحالة', en: 'Status', sample: { ar: 'AWAITING_FORM', en: 'AWAITING_FORM' } },
  daysWaiting: { ar: 'الأيام منذ آخر تغيير', en: 'Days waiting', sample: { ar: '3', en: '3' } },
  daysLeft: { ar: 'الأيام المتبقية', en: 'Days left', sample: { ar: '14', en: '14' } },
  docType: { ar: 'نوع المستند', en: 'Document type', sample: { ar: 'IQAMA', en: 'IQAMA' } },
  docNumber: { ar: 'رقم المستند', en: 'Document number', sample: { ar: '2382910044', en: '2382910044' } },
  expiryDate: { ar: 'تاريخ الانتهاء', en: 'Expiry date', sample: { ar: '2026-08-25', en: '2026-08-25' } },
  linkUrl: { ar: 'رابط الإجراء', en: 'Action link', sample: { ar: 'https://…/form/…', en: 'https://…/form/…' } },
  employeeLink: {
    ar: 'رابط ملف الموظف',
    en: 'Employee file link',
    sample: { ar: 'https://…/employees/…', en: 'https://…/employees/…' },
  },
  missingItems: {
    ar: 'النواقص المطلوبة',
    en: 'Missing items',
    sample: { ar: 'صورة الهوية، خطاب الآيبان', en: 'ID copy, IBAN letter' },
  },
  rejectReason: { ar: 'سبب الرفض', en: 'Rejection reason', sample: { ar: 'الراتب غير مطابق', en: 'Salary does not match' } },
  contractSalary: { ar: 'الراتب', en: 'Salary', sample: { ar: '9٬000', en: '9,000' } },
  contractDuration: { ar: 'مدة العقد بالأشهر', en: 'Duration in months', sample: { ar: '12', en: '12' } },
  contractStartDate: { ar: 'تاريخ المباشرة', en: 'Contract start date', sample: { ar: '2026-10-01', en: '2026-10-01' } },
  contractEndDate: { ar: 'تاريخ انتهاء العقد', en: 'Contract end date', sample: { ar: '2027-09-30', en: '2027-09-30' } },
  contractTerms: { ar: 'بنود العقد', en: 'Contract terms', sample: { ar: 'دوام كامل', en: 'Full time' } },
  contractRef: { ar: 'رقم العقد', en: 'Contract reference', sample: { ar: 'C-2026-114', en: 'C-2026-114' } },
  contractLink: {
    ar: 'رابط عرض العقد',
    en: 'Contract page link',
    sample: { ar: 'https://…/contract/…', en: 'https://…/contract/…' },
  },
  formLink: {
    ar: 'رابط نموذج بيانات الموظف',
    en: 'Employee data-form link',
    sample: { ar: 'https://…/form/…', en: 'https://…/form/…' },
  },
  email: { ar: 'البريد الإلكتروني', en: 'Email', sample: { ar: 'nora@riyada-ksa.com', en: 'nora@riyada-ksa.com' } },
  tempPassword: { ar: 'كلمة المرور المؤقتة', en: 'Temporary password', sample: { ar: 'Kq7mXp29TzRw', en: 'Kq7mXp29TzRw' } },
};

export interface TemplateMeta {
  audience: 'employee' | 'staff';
  nameAr: string;
  nameEn: string;
  /** Placeholders the sending code actually provides for this template. */
  placeholders: string[];
  /** True when the message normally carries an action link (branded HTML). */
  hasCta: boolean;
}

const EMP = ['name', 'employeeNo', 'department', 'jobTitle'];
/** Staff-facing messages always carry the employee's file. */
const STAFF = [...EMP, 'employeeLink'];
const CONTRACT = [
  'contractSalary',
  'contractDuration',
  'contractStartDate',
  'contractEndDate',
  'contractTerms',
  'contractRef',
];

export const TEMPLATE_CATALOG: Record<string, TemplateMeta> = {
  // ── the trainee / employee ──────────────────────────────────────────────
  'employee.form_invite': {
    audience: 'employee', nameAr: 'دعوة استكمال بيانات التوظيف', nameEn: 'Employment details invite',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.form_reminder': {
    audience: 'employee', nameAr: 'تذكير باستكمال البيانات', nameEn: 'Employment details reminder',
    placeholders: [...EMP, 'daysWaiting', 'linkUrl'], hasCta: true,
  },
  'employee.form_missing': {
    audience: 'employee', nameAr: 'طلب استكمال نواقص', nameEn: 'Missing details or documents',
    placeholders: [...EMP, 'missingItems', 'linkUrl'], hasCta: true,
  },
  'employee.contract_ready': {
    audience: 'employee', nameAr: 'عقد العمل بانتظار موافقتك', nameEn: 'Contract awaiting your approval',
    placeholders: [...EMP, ...CONTRACT, 'contractLink'], hasCta: true,
  },
  'employee.contract_approval_reminder': {
    audience: 'employee', nameAr: 'تذكير – عقد بانتظار الموافقة', nameEn: 'Reminder – contract awaiting approval',
    placeholders: [...EMP, 'daysWaiting', ...CONTRACT, 'contractLink'], hasCta: true,
  },
  'employee.asset_approval': {
    audience: 'employee', nameAr: 'اعتماد استلام العهدة', nameEn: 'Confirm receipt of assets',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.asset_reminder': {
    audience: 'employee', nameAr: 'تذكير – نموذج العهدة', nameEn: 'Reminder – custody form',
    placeholders: [...EMP, 'daysWaiting', 'linkUrl'], hasCta: true,
  },
  'employee.exit_interview': {
    audience: 'employee', nameAr: 'مقابلة إنهاء الخدمة', nameEn: 'Exit interview',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.termination_notice': {
    audience: 'employee', nameAr: 'إشعار إنهاء الخدمة', nameEn: 'Termination notice',
    placeholders: EMP, hasCta: false,
  },

  // ── the team: onboarding pipeline ───────────────────────────────────────
  'staff.form_pending': {
    audience: 'staff', nameAr: 'تذكير – بيانات التوظيف بانتظار الاستكمال', nameEn: 'Reminder – employment details pending',
    placeholders: [...STAFF, 'daysWaiting'], hasCta: true,
  },
  'hr.form_submitted': {
    audience: 'staff', nameAr: 'تم استكمال بيانات المتدرب', nameEn: 'Trainee details completed',
    placeholders: STAFF, hasCta: true,
  },
  'staff.form_missing': {
    audience: 'staff', nameAr: 'طلب استكمال نواقص (نسخة الفريق)', nameEn: 'Missing items requested (team copy)',
    placeholders: [...STAFF, 'missingItems'], hasCta: true,
  },
  'staff.form_expired': {
    audience: 'staff', nameAr: 'انتهاء مهلة استكمال البيانات', nameEn: 'Details deadline expired',
    placeholders: STAFF, hasCta: true,
  },
  'hr.ready_for_contract': {
    audience: 'staff', nameAr: 'جاهز لإنشاء عقد العمل', nameEn: 'Ready for contract creation',
    placeholders: STAFF, hasCta: true,
  },
  'staff.contract_pending_creation': {
    audience: 'staff', nameAr: 'تذكير – عقد بانتظار الإنشاء', nameEn: 'Reminder – contract awaiting creation',
    placeholders: [...STAFF, 'daysWaiting'], hasCta: true,
  },
  'staff.contract_approval_pending': {
    audience: 'staff', nameAr: 'تذكير – عقد بانتظار الموافقة (الفريق)', nameEn: 'Reminder – contract awaiting approval (team)',
    placeholders: [...STAFF, 'daysWaiting'], hasCta: true,
  },
  'staff.contract_approval_expired': {
    audience: 'staff', nameAr: 'انتهاء مهلة الموافقة على العقد', nameEn: 'Contract approval deadline expired',
    placeholders: STAFF, hasCta: true,
  },
  'hr.contract_status_active': {
    audience: 'staff', nameAr: 'تم تحديث حالة العقد إلى Active', nameEn: 'Contract status updated to Active',
    placeholders: STAFF, hasCta: true,
  },
  'hr.contract_rejected': {
    audience: 'staff', nameAr: 'تم رفض العقد', nameEn: 'Contract rejected',
    placeholders: [...STAFF, 'rejectReason'], hasCta: true,
  },
  'hr.employee_activated': {
    audience: 'staff', nameAr: 'تم إنشاء ملف الموظف', nameEn: 'Employee file created',
    placeholders: STAFF, hasCta: true,
  },

  // ── the team: custody ───────────────────────────────────────────────────
  'staff.asset_pending': {
    audience: 'staff', nameAr: 'تذكير – نموذج العهدة بانتظار الاعتماد (الفريق)', nameEn: 'Reminder – custody form pending (team)',
    placeholders: [...STAFF, 'daysWaiting'], hasCta: true,
  },
  'hr.asset_approved': {
    audience: 'staff', nameAr: 'تم اعتماد نموذج العهدة', nameEn: 'Custody form confirmed',
    placeholders: STAFF, hasCta: true,
  },
  'hr.asset_rejected': {
    audience: 'staff', nameAr: 'تم رفض نموذج العهدة', nameEn: 'Custody form rejected',
    placeholders: [...STAFF, 'rejectReason'], hasCta: true,
  },

  // ── the team: generic automation, documents, offboarding, system ────────
  'staff.record_stalled': {
    audience: 'staff', nameAr: 'تذكير عام: سجل متوقف', nameEn: 'Generic reminder: record stalled',
    placeholders: [...STAFF, 'status', 'daysWaiting'], hasCta: true,
  },
  'staff.escalation': {
    audience: 'staff', nameAr: 'تصعيد', nameEn: 'Escalation',
    placeholders: [...STAFF, 'status', 'daysWaiting'], hasCta: true,
  },
  'staff.record_expired': {
    audience: 'staff', nameAr: 'انتهت المهلة (عام)', nameEn: 'Deadline expired (generic)',
    placeholders: [...STAFF, 'status'], hasCta: true,
  },
  'staff.document_expiring': {
    audience: 'staff', nameAr: 'مستند يقارب الانتهاء', nameEn: 'Document expiring',
    placeholders: [...STAFF, 'docType', 'docNumber', 'expiryDate', 'daysLeft'], hasCta: true,
  },
  'staff.document_expiry_escalation': {
    audience: 'staff', nameAr: 'تصعيد: انتهاء مستند', nameEn: 'Escalation: document expiry',
    placeholders: [...STAFF, 'docType', 'expiryDate'], hasCta: true,
  },
  'hr.exit_interview_done': {
    audience: 'staff', nameAr: 'اكتملت مقابلة إنهاء الخدمة', nameEn: 'Exit interview completed',
    placeholders: STAFF, hasCta: true,
  },
  'staff.invitation': {
    audience: 'staff', nameAr: 'دعوة مستخدم جديد', nameEn: 'Staff invitation',
    placeholders: ['name', 'email', 'tempPassword', 'linkUrl'], hasCta: true,
  },
  /** Free-form template for admin-defined triggers — often addressed to the employee, so no internal link. */
  'custom.status_change': {
    audience: 'employee', nameAr: 'رسالة عند تغيّر الحالة', nameEn: 'Status-change message',
    placeholders: [...EMP, 'status'], hasCta: false,
  },
};

/** Every status a trigger can fire on, per state machine. */
export const MACHINE_STATUSES: Record<string, string[]> = {
  EMPLOYEE: [
    'CREATED', 'AWAITING_FORM', 'FORM_RECEIVED', 'CONTRACT_CREATION',
    'AWAITING_CONTRACT_APPROVAL', 'EXPIRED', 'ACTIVE', 'INACTIVE', 'WITHDRAWN',
  ],
  GOSI: ['PENDING', 'DONE', 'ON_HOLD', 'CANCELLED'],
  MEDICAL_INSURANCE: ['PENDING', 'DONE', 'ON_HOLD', 'CANCELLED'],
  CRIMINAL_RECORD: ['TRAINING', 'REQUEST_SENT', 'PENDING', 'DONE'],
  ASSET_FORM: ['DRAFT', 'SENT', 'PENDING_EMPLOYEE_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
  OFFBOARDING: [
    'REQUESTED', 'IN_PROGRESS', 'ASSETS_PENDING', 'NOTICE_SENT', 'SETTLEMENT', 'CLOSED', 'CANCELLED',
  ],
};

export const STAFF_ROLES = ['HR', 'INSURANCE', 'IT', 'FINANCE', 'ADMIN'] as const;
