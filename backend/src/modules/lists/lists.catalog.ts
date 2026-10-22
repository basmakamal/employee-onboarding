/**
 * Every dropdown in the system, described once.
 *
 * Two kinds of list:
 *  - `enum`: the codes are a Prisma enum or a workflow status. The database
 *    and the state machines depend on them, so admins may rename (per
 *    language) and reorder, never add or remove.
 *  - `free`: plain text on the record (department, nationality, asset type…).
 *    Admins add and remove values; staff typing a new value in a form adds it
 *    too. The public data form may offer "Other" where `allowOther` is set,
 *    because a new hire cannot add to the system.
 */
export type ListKind = 'enum' | 'free';

export interface ListDef {
  key: string;
  kind: ListKind;
  nameAr: string;
  nameEn: string;
  /** Shown on the public data form (values fetched without sign-in). */
  publicForm?: boolean;
  /** The public form offers "Other" with a free-text box. */
  allowOther?: boolean;
  /** Starting values; enum lists are complete here, free lists grow. */
  defaults: Array<{ code: string; ar: string; en: string }>;
}

const v = (code: string, ar: string, en: string) => ({ code, ar, en });

export const LIST_DEFS: ListDef[] = [
  // ── the data form ─────────────────────────────────────────────────────
  {
    key: 'GENDER', kind: 'enum', nameAr: 'الجنس', nameEn: 'Gender', publicForm: true,
    defaults: [v('MALE', 'ذكر', 'Male'), v('FEMALE', 'أنثى', 'Female')],
  },
  {
    key: 'MARITAL_STATUS', kind: 'enum', nameAr: 'الحالة الاجتماعية', nameEn: 'Marital status', publicForm: true,
    defaults: [
      v('SINGLE', 'أعزب / عزباء', 'Single'),
      v('MARRIED', 'متزوج / متزوجة', 'Married'),
      v('DIVORCED', 'مطلّق / مطلّقة', 'Divorced'),
      v('WIDOWED', 'أرمل / أرملة', 'Widowed'),
    ],
  },
  {
    key: 'QUALIFICATION', kind: 'enum', nameAr: 'المؤهل العلمي', nameEn: 'Qualification', publicForm: true,
    defaults: [
      v('HIGH_SCHOOL', 'ثانوية عامة', 'High school'),
      v('DIPLOMA', 'دبلوم', 'Diploma'),
      v('BACHELOR', 'بكالوريوس', "Bachelor's degree"),
      v('MASTER', 'ماجستير', "Master's degree"),
      v('PHD', 'دكتوراه', 'Doctorate'),
      v('OTHER', 'أخرى', 'Other'),
    ],
  },
  {
    key: 'NATIONALITY', kind: 'free', nameAr: 'الجنسية', nameEn: 'Nationality', publicForm: true, allowOther: true,
    defaults: [
      v('SA', 'سعودي', 'Saudi'), v('YE', 'يمني', 'Yemeni'), v('EG', 'مصري', 'Egyptian'),
      v('SD', 'سوداني', 'Sudanese'), v('SY', 'سوري', 'Syrian'), v('JO', 'أردني', 'Jordanian'),
      v('PS', 'فلسطيني', 'Palestinian'), v('LB', 'لبناني', 'Lebanese'), v('IQ', 'عراقي', 'Iraqi'),
      v('KW', 'كويتي', 'Kuwaiti'), v('BH', 'بحريني', 'Bahraini'), v('QA', 'قطري', 'Qatari'),
      v('AE', 'إماراتي', 'Emirati'), v('OM', 'عُماني', 'Omani'), v('PK', 'باكستاني', 'Pakistani'),
      v('IN', 'هندي', 'Indian'), v('BD', 'بنغلاديشي', 'Bangladeshi'), v('PH', 'فلبيني', 'Filipino'),
      v('LK', 'سريلانكي', 'Sri Lankan'), v('NP', 'نيبالي', 'Nepali'), v('ID', 'إندونيسي', 'Indonesian'),
      v('MA', 'مغربي', 'Moroccan'), v('TN', 'تونسي', 'Tunisian'), v('DZ', 'جزائري', 'Algerian'),
      v('SO', 'صومالي', 'Somali'), v('ET', 'إثيوبي', 'Ethiopian'), v('ER', 'إريتري', 'Eritrean'),
      v('TR', 'تركي', 'Turkish'),
    ],
  },

  // ── the employee record ───────────────────────────────────────────────
  { key: 'DEPARTMENT', kind: 'free', nameAr: 'الإدارات', nameEn: 'Departments', defaults: [] },
  { key: 'PROJECT', kind: 'free', nameAr: 'المشاريع', nameEn: 'Projects', defaults: [] },
  { key: 'JOB_TITLE', kind: 'free', nameAr: 'المسميات الوظيفية', nameEn: 'Job titles', defaults: [] },
  {
    key: 'EMPLOYMENT_TYPE', kind: 'enum', nameAr: 'نوع التوظيف', nameEn: 'Employment type',
    defaults: [v('FULL_TIME', 'دوام كامل', 'Full time'), v('PART_TIME', 'دوام جزئي', 'Part time'), v('TEMPORARY', 'مؤقت', 'Temporary')],
  },

  // ── documents and assets ──────────────────────────────────────────────
  {
    key: 'DOC_TYPE', kind: 'free', nameAr: 'أنواع المستندات (تاريخ انتهاء)', nameEn: 'Document types (expiry tracked)',
    defaults: [
      v('IQAMA', 'الإقامة', 'Iqama'), v('NATIONAL_ID', 'الهوية الوطنية', 'National ID'),
      v('PASSPORT', 'جواز السفر', 'Passport'), v('CONTRACT', 'عقد العمل', 'Employment contract'),
      v('WORK_PERMIT', 'رخصة العمل', 'Work permit'), v('DRIVING_LICENSE', 'رخصة القيادة', 'Driving licence'),
    ],
  },
  {
    key: 'CHECKLIST_DOC_TYPE', kind: 'free', nameAr: 'مستندات نموذج البيانات', nameEn: 'Data-form documents',
    defaults: [
      v('NATIONAL_ID', 'الهوية الوطنية / الإقامة', 'National ID / Iqama'),
      v('QUALIFICATION', 'شهادة المؤهل', 'Qualification certificate'),
      v('PHOTO', 'الصورة الشخصية', 'Personal photo'),
      v('IBAN_LETTER', 'شهادة الآيبان', 'IBAN letter'),
    ],
  },
  {
    key: 'ASSET_TYPE', kind: 'free', nameAr: 'أنواع العهد', nameEn: 'Asset types',
    defaults: [
      v('LAPTOP', 'حاسب محمول', 'Laptop'), v('MONITOR', 'شاشة', 'Monitor'), v('PHONE', 'هاتف', 'Phone'),
      v('SIM_CARD', 'شريحة اتصال', 'SIM card'), v('HEADPHONE', 'سماعة رأس', 'Headset'), v('ACCESS_CARD', 'بطاقة دخول', 'Access card'),
    ],
  },

  // ── processes ─────────────────────────────────────────────────────────
  {
    key: 'REQUEST_TYPE', kind: 'enum', nameAr: 'أنواع الطلبات والخدمات', nameEn: 'Request types',
    defaults: [
      v('SALARY_LETTER', 'تعريف بالراتب', 'Salary letter'), v('BANK_LETTER', 'خطاب للبنك', 'Bank letter'),
      v('DEPARTMENT_CHANGE', 'نقل إدارة', 'Department change'), v('JOB_TITLE_CHANGE', 'تغيير مسمى', 'Job title change'),
      v('PROMOTION', 'ترقية', 'Promotion'), v('PROJECT_TRANSFER', 'نقل مشروع', 'Project transfer'),
      v('WARNING', 'إنذار', 'Warning'), v('INVESTIGATION', 'تحقيق', 'Investigation'),
    ],
  },
  {
    key: 'OFFBOARDING_REASON', kind: 'enum', nameAr: 'أسباب إنهاء الخدمة', nameEn: 'Offboarding reasons',
    defaults: [
      v('RESIGNATION', 'استقالة', 'Resignation'), v('TERMINATION', 'إنهاء خدمات', 'Termination'),
      v('CONTRACT_EXPIRY', 'انتهاء العقد', 'Contract expiry'), v('RETIREMENT', 'تقاعد', 'Retirement'), v('DEATH', 'وفاة', 'Death'),
    ],
  },

  // ── the system itself ─────────────────────────────────────────────────
  {
    key: 'ROLE', kind: 'enum', nameAr: 'مجموعات المستخدمين', nameEn: 'User groups',
    defaults: [
      v('HR', 'الموارد البشرية', 'Human Resources'), v('INSURANCE', 'التأمينات', 'Insurance'),
      v('IT', 'تقنية المعلومات', 'IT'), v('FINANCE', 'المالية', 'Finance'), v('ADMIN', 'مسؤول النظام', 'Administrator'),
    ],
  },
  {
    key: 'EMPLOYEE_STATUS', kind: 'enum', nameAr: 'حالات الموظف', nameEn: 'Employee statuses',
    defaults: [
      v('CREATED', 'تم الإنشاء', 'Created'), v('AWAITING_FORM', 'بانتظار النموذج', 'Awaiting form'),
      v('FORM_RECEIVED', 'تم استلام النموذج', 'Form received'), v('CONTRACT_CREATION', 'إنشاء العقد', 'Contract creation'),
      v('AWAITING_CONTRACT_APPROVAL', 'بانتظار الموافقة', 'Awaiting approval'), v('EXPIRED', 'منتهي', 'Expired'),
      v('ACTIVE', 'موظف فعال', 'Active'), v('INACTIVE', 'غير فعال', 'Inactive'), v('WITHDRAWN', 'منسحب', 'Withdrawn'),
    ],
  },
];

export const LIST_BY_KEY: Record<string, ListDef> = Object.fromEntries(LIST_DEFS.map((d) => [d.key, d]));
