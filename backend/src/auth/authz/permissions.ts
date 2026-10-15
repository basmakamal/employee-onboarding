/**
 * The permission catalogue — every action the system can gate, as stable
 * codes. Roles are rows in the database that bundle these codes; the codes
 * themselves live here so a typo is a compile error and the UI can offer
 * the full list when an admin edits a role.
 *
 * Naming: `<area>.<verb>`. Keep verbs coarse (read / write / manage); the
 * organisational SCOPE of a permission (which company, which branch) is
 * never part of the code — it comes from the user's assignment.
 */
export const PERMISSIONS = {
  // ── global administration (no company context needed)
  'companies.manage': { nameAr: 'إدارة الشركات', nameEn: 'Manage companies' },
  'users.manage': { nameAr: 'إدارة المستخدمين والصلاحيات', nameEn: 'Manage users, roles and assignments' },
  'settings.manage': { nameAr: 'إدارة إعدادات النظام', nameEn: 'Manage system settings' },

  // ── organisation (inside the active company)
  'org.read': { nameAr: 'عرض الهيكل التنظيمي', nameEn: 'View organisational structure' },
  'org.manage': { nameAr: 'إدارة الهيكل التنظيمي', nameEn: 'Manage branches, departments, teams and positions' },
  'lists.manage': { nameAr: 'إدارة القوائم', nameEn: 'Manage dropdown lists' },

  // ── employees & onboarding
  'employees.read': { nameAr: 'عرض الموظفين', nameEn: 'View employees' },
  'employees.write': { nameAr: 'إضافة وتعديل الموظفين', nameEn: 'Create and edit employees' },
  'employees.delete': { nameAr: 'حذف الموظفين', nameEn: 'Delete employees' },
  'onboarding.manage': { nameAr: 'إدارة مراحل التعيين', nameEn: 'Manage the onboarding pipeline' },
  'contracts.write': { nameAr: 'إدارة العقود', nameEn: 'Create and update contracts' },
  'documents.read': { nameAr: 'عرض المستندات', nameEn: 'View documents' },
  'documents.write': { nameAr: 'إدارة المستندات', nameEn: 'Upload and manage documents' },
  'requests.write': { nameAr: 'تسجيل الطلبات والخدمات', nameEn: 'Log HR requests and services' },

  // ── stage-2 processes
  'processes.gosi': { nameAr: 'التأمينات الاجتماعية', nameEn: 'GOSI process' },
  'processes.medical': { nameAr: 'التأمين الطبي', nameEn: 'Medical insurance process' },
  'processes.criminal': { nameAr: 'خلو السوابق', nameEn: 'Criminal record process' },
  'assets.manage': { nameAr: 'إدارة العهد', nameEn: 'Manage assets and custody forms' },

  // ── stage-3
  'offboarding.manage': { nameAr: 'إدارة إنهاء التعاقد', nameEn: 'Manage offboarding' },
  'settlement.approve': { nameAr: 'اعتماد التسوية النهائية', nameEn: 'Approve final settlement' },

  // ── insight
  'reports.view': { nameAr: 'عرض التقارير', nameEn: 'View reports and dashboards' },
  'reports.export': { nameAr: 'تصدير التقارير', nameEn: 'Export reports' },
  'emails.view': { nameAr: 'عرض سجل الرسائل', nameEn: 'View the e-mail log' },
  'ai.use': { nameAr: 'استخدام المساعد الذكي', nameEn: 'Use the AI assistant' },
  'audit.read': { nameAr: 'عرض سجل التدقيق', nameEn: 'View the audit trail' },

  // ── workforce
  'schedule.read': { nameAr: 'عرض جداول العمل', nameEn: 'View work schedules' },
  'schedule.manage': { nameAr: 'إدارة الورديات وجداول العمل', nameEn: 'Manage shifts and work schedules' },
  'attendance.read': { nameAr: 'عرض الحضور والانصراف', nameEn: 'View attendance' },
  'attendance.manage': { nameAr: 'تسجيل الحضور ومراجعة المخالفات', nameEn: 'Record attendance and review exceptions' },
  'attendance.approve': { nameAr: 'اعتماد العمل الإضافي', nameEn: 'Approve overtime' },
  'leave.read': { nameAr: 'عرض الإجازات والأرصدة', nameEn: 'View leave and balances' },
  'leave.manage': { nameAr: 'إدخال الإجازات وإدارة أنواعها والأرصدة', nameEn: 'Enter leave, manage leave types and balances' },
  'leave.approve': { nameAr: 'اعتماد الإجازات', nameEn: 'Approve leave' },

  // ── compensation & payroll (salary is confidential: unit managers never get these)
  'compensation.read': { nameAr: 'عرض الرواتب', nameEn: 'View employee pay' },
  'compensation.write': { nameAr: 'تعديل الرواتب', nameEn: 'Change employee pay' },
  'payroll.manage': { nameAr: 'إعدادات الرواتب ومكوناتها', nameEn: 'Manage pay components and payroll settings' },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(code: string): code is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, code);
}

/**
 * The roles the seed creates. The four functional roles mirror today's
 * `Role` enum one-to-one so existing users keep exactly what they could do;
 * the three structural roles are new. `system` roles cannot be deleted,
 * only re-bundled.
 */
export const SYSTEM_ROLES: Array<{
  code: string;
  nameAr: string;
  nameEn: string;
  /** Where this role is meant to be assigned — guides the admin UI, never enforced by code paths. */
  level: 'GLOBAL' | 'COMPANY' | 'UNIT';
  permissions: Permission[];
}> = [
  {
    code: 'SUPER_ADMIN',
    nameAr: 'مدير النظام',
    nameEn: 'Super admin',
    level: 'GLOBAL',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'COMPANY_MANAGER',
    nameAr: 'مدير الشركة',
    nameEn: 'Company manager',
    level: 'COMPANY',
    permissions: ALL_PERMISSIONS.filter((p) => !['companies.manage', 'users.manage', 'settings.manage'].includes(p)),
  },
  {
    code: 'UNIT_MANAGER',
    nameAr: 'مدير وحدة تنظيمية',
    nameEn: 'Unit manager (branch / department / team)',
    level: 'UNIT',
    permissions: ['org.read', 'employees.read', 'documents.read', 'requests.write', 'reports.view', 'audit.read', 'schedule.read', 'attendance.read', 'attendance.approve', 'leave.read', 'leave.approve'],
  },
  {
    code: 'HR',
    nameAr: 'الموارد البشرية',
    nameEn: 'HR',
    level: 'COMPANY',
    permissions: [
      'org.read', 'employees.read', 'employees.write', 'onboarding.manage', 'contracts.write',
      'documents.read', 'documents.write', 'requests.write', 'processes.criminal',
      'offboarding.manage', 'reports.view', 'reports.export', 'emails.view', 'ai.use',
      'schedule.read', 'schedule.manage', 'attendance.read', 'attendance.manage', 'leave.read', 'leave.manage',
      'compensation.read', 'compensation.write',
    ],
  },
  {
    code: 'PAYROLL_OFFICER',
    nameAr: 'مسؤول الرواتب',
    nameEn: 'Payroll officer',
    level: 'COMPANY',
    permissions: ['org.read', 'employees.read', 'attendance.read', 'leave.read', 'compensation.read', 'compensation.write', 'payroll.manage', 'reports.view'],
  },
  {
    code: 'INSURANCE',
    nameAr: 'التأمينات',
    nameEn: 'Insurance',
    level: 'COMPANY',
    permissions: ['org.read', 'employees.read', 'documents.read', 'processes.gosi', 'processes.medical'],
  },
  {
    code: 'IT',
    nameAr: 'تقنية المعلومات',
    nameEn: 'IT',
    level: 'COMPANY',
    permissions: ['org.read', 'employees.read', 'assets.manage'],
  },
  {
    code: 'FINANCE',
    nameAr: 'المالية',
    nameEn: 'Finance',
    level: 'COMPANY',
    permissions: ['org.read', 'employees.read', 'settlement.approve', 'reports.view'],
  },
];
