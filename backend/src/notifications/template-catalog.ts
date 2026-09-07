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

export const TEMPLATE_CATALOG: Record<string, TemplateMeta> = {
  'employee.form_invite': {
    audience: 'employee', nameAr: 'دعوة نموذج البيانات', nameEn: 'Data form invite',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.form_reminder': {
    audience: 'employee', nameAr: 'تذكير بنموذج البيانات', nameEn: 'Data form reminder',
    placeholders: [...EMP, 'daysWaiting', 'linkUrl'], hasCta: true,
  },
  'employee.contract_approval_reminder': {
    audience: 'employee', nameAr: 'اعتماد العقد', nameEn: 'Contract approval',
    placeholders: [...EMP, 'daysWaiting', 'linkUrl'], hasCta: true,
  },
  'employee.asset_approval': {
    audience: 'employee', nameAr: 'اعتماد العهدة', nameEn: 'Asset custody approval',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.exit_interview': {
    audience: 'employee', nameAr: 'مقابلة إنهاء الخدمة', nameEn: 'Exit interview',
    placeholders: [...EMP, 'linkUrl'], hasCta: true,
  },
  'employee.termination_notice': {
    audience: 'employee', nameAr: 'إشعار إنهاء الخدمة', nameEn: 'Termination notice',
    placeholders: EMP, hasCta: false,
  },
  'staff.record_stalled': {
    audience: 'staff', nameAr: 'تذكير: سجل متوقف', nameEn: 'Reminder: record stalled',
    placeholders: [...EMP, 'status', 'daysWaiting'], hasCta: false,
  },
  'staff.escalation': {
    audience: 'staff', nameAr: 'تصعيد', nameEn: 'Escalation',
    placeholders: [...EMP, 'status', 'daysWaiting'], hasCta: false,
  },
  'staff.record_expired': {
    audience: 'staff', nameAr: 'انتهت المهلة', nameEn: 'Deadline expired',
    placeholders: [...EMP, 'status'], hasCta: false,
  },
  'staff.document_expiring': {
    audience: 'staff', nameAr: 'مستند يقارب الانتهاء', nameEn: 'Document expiring',
    placeholders: [...EMP, 'docType', 'docNumber', 'expiryDate', 'daysLeft'], hasCta: false,
  },
  'staff.document_expiry_escalation': {
    audience: 'staff', nameAr: 'تصعيد: انتهاء مستند', nameEn: 'Escalation: document expiry',
    placeholders: [...EMP, 'docType', 'expiryDate'], hasCta: false,
  },
  'hr.contract_approved': {
    audience: 'staff', nameAr: 'تم اعتماد العقد', nameEn: 'Contract approved',
    placeholders: EMP, hasCta: false,
  },
  'hr.asset_decided': {
    audience: 'staff', nameAr: 'قرار العهدة', nameEn: 'Asset custody decision',
    placeholders: EMP, hasCta: false,
  },
  'hr.exit_interview_done': {
    audience: 'staff', nameAr: 'اكتملت مقابلة إنهاء الخدمة', nameEn: 'Exit interview completed',
    placeholders: EMP, hasCta: false,
  },
  /** Free-form template for admin-defined triggers (no built-in default). */
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
