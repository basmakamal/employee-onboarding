/**
 * Bilingual notification templates. Every message exists in Arabic and
 * English; the recipient's locale picks the variant (trainees get Arabic by
 * default, staff get their UI language later).
 */
export type Locale = 'ar' | 'en';

export interface RenderedMessage {
  subject: string;
  text: string;
}

interface TemplateParams {
  name?: string;
  status?: string;
  daysWaiting?: number;
  linkUrl?: string;
}

type Template = (p: TemplateParams) => RenderedMessage;

const T: Record<string, Record<Locale, Template>> = {
  /** 24h reminder — trainee has not completed the data form. */
  'trainee.form_reminder': {
    ar: (p) => ({
      subject: 'تذكير: استكمال نموذج البيانات',
      text:
        `مرحبًا ${p.name ?? ''},\n\n` +
        `نذكّرك باستكمال نموذج البيانات والمستندات المطلوبة لإتمام إجراءات التعيين.` +
        (p.linkUrl ? `\n\nرابط النموذج: ${p.linkUrl}` : '') +
        `\n\nقسم الموارد البشرية`,
    }),
    en: (p) => ({
      subject: 'Reminder: complete your data form',
      text:
        `Hello ${p.name ?? ''},\n\n` +
        `This is a reminder to complete your data form and required documents.` +
        (p.linkUrl ? `\n\nForm link: ${p.linkUrl}` : '') +
        `\n\nHR Department`,
    }),
  },

  /** Generic staff reminder — any record stalled in any watched status. */
  'staff.record_stalled': {
    ar: (p) => ({
      subject: `متابعة: ${p.name ?? ''} — ${p.status ?? ''}`,
      text: `السجل الخاص بـ ${p.name ?? ''} في حالة ${p.status ?? ''} منذ ${p.daysWaiting ?? '?'} يومًا. يرجى المتابعة من النظام.`,
    }),
    en: (p) => ({
      subject: `Follow-up: ${p.name ?? ''} — ${p.status ?? ''}`,
      text: `The record for ${p.name ?? ''} has been in status ${p.status ?? ''} for ${p.daysWaiting ?? '?'} day(s). Please follow up in the system.`,
    }),
  },

  /** Escalation — reminders were ignored; a higher group steps in. */
  'staff.escalation': {
    ar: (p) => ({
      subject: `تصعيد: ${p.name ?? ''} متوقف منذ ${p.daysWaiting ?? '?'} يومًا`,
      text: `تصعيد تلقائي: سجل ${p.name ?? ''} لا يزال في حالة ${p.status ?? ''} منذ ${p.daysWaiting ?? '?'} يومًا رغم التذكيرات السابقة. يتطلب تدخلًا.`,
    }),
    en: (p) => ({
      subject: `Escalation: ${p.name ?? ''} stalled for ${p.daysWaiting ?? '?'} day(s)`,
      text: `Automatic escalation: the record for ${p.name ?? ''} is still in status ${p.status ?? ''} after ${p.daysWaiting ?? '?'} day(s) despite earlier reminders. Intervention required.`,
    }),
  },

  /** A deadline expired and the system closed the window. */
  'staff.record_expired': {
    ar: (p) => ({
      subject: `انتهت المهلة: ${p.name ?? ''}`,
      text: `انتهت المهلة المحددة لسجل ${p.name ?? ''} (الحالة: ${p.status ?? ''}) وتم تغييرها تلقائيًا. يمكن إعادة الفتح من النظام.`,
    }),
    en: (p) => ({
      subject: `Deadline expired: ${p.name ?? ''}`,
      text: `The deadline for ${p.name ?? ''} (status: ${p.status ?? ''}) has passed and was changed automatically. It can be reopened from the system.`,
    }),
  },

  /** HR copy of a trainee reminder / stalled record. */
  'hr.trainee_waiting': {
    ar: (p) => ({
      subject: `متابعة: طلب المتدرب ${p.name ?? ''} لا يزال معلقًا`,
      text:
        `طلب المتدرب ${p.name ?? ''} في انتظار الإجراء منذ ${p.daysWaiting ?? '?'} يومًا.\n` +
        `يرجى المتابعة من لوحة النظام.`,
    }),
    en: (p) => ({
      subject: `Follow-up: trainee ${p.name ?? ''} is still waiting`,
      text:
        `Trainee ${p.name ?? ''} has been waiting for action for ${p.daysWaiting ?? '?'} day(s).\n` +
        `Please follow up from the system dashboard.`,
    }),
  },

  /** HR reminder — contract has not been created yet (2 working days). */
  'hr.contract_creation_due': {
    ar: (p) => ({
      subject: `تذكير: إنشاء عقد للمتدرب ${p.name ?? ''}`,
      text: `اكتملت مستندات المتدرب ${p.name ?? ''} ولم يتم إنشاء العقد بعد. يرجى استكمال إنشاء العقد.`,
    }),
    en: (p) => ({
      subject: `Reminder: create the contract for ${p.name ?? ''}`,
      text: `Documents for trainee ${p.name ?? ''} are complete but no contract has been created yet. Please complete contract creation.`,
    }),
  },

  /** Daily reminder — contract awaiting the trainee's approval. */
  'trainee.contract_approval_reminder': {
    ar: (p) => ({
      subject: 'تذكير: اعتماد عقد العمل',
      text:
        `مرحبًا ${p.name ?? ''},\n\n` +
        `عقد العمل الخاص بك في انتظار اعتمادك.` +
        (p.linkUrl ? `\n\nرابط الاعتماد: ${p.linkUrl}` : '') +
        `\n\nقسم الموارد البشرية`,
    }),
    en: (p) => ({
      subject: 'Reminder: approve your employment contract',
      text:
        `Hello ${p.name ?? ''},\n\n` +
        `Your employment contract is awaiting your approval.` +
        (p.linkUrl ? `\n\nApproval link: ${p.linkUrl}` : '') +
        `\n\nHR Department`,
    }),
  },

  /** Employee — exit interview form (auto-sent for resignations, BRD). */
  'employee.exit_interview': {
    ar: (p) => ({
      subject: 'نموذج مقابلة إنهاء الخدمة',
      text:
        `مرحبًا ${p.name ?? ''},\n\n` +
        `نرجو استكمال نموذج مقابلة إنهاء الخدمة إلكترونيًا.` +
        (p.linkUrl ? `\n\nرابط النموذج: ${p.linkUrl}` : '') +
        `\n\nقسم الموارد البشرية`,
    }),
    en: (p) => ({
      subject: 'Exit interview form',
      text:
        `Hello ${p.name ?? ''},\n\n` +
        `Please complete your exit interview form electronically.` +
        (p.linkUrl ? `\n\nForm link: ${p.linkUrl}` : '') +
        `\n\nHR Department`,
    }),
  },

  /** Employee — official termination notice (BRD step 3). */
  'employee.termination_notice': {
    ar: (p) => ({
      subject: 'إشعار إنهاء الخدمة',
      text:
        `عزيزنا ${p.name ?? ''},\n\n` +
        `نشعركم بإنهاء العلاقة التعاقدية وفق الإجراءات المعتمدة. سيتم التواصل معكم بخصوص المخالصة النهائية.\n\n` +
        `قسم الموارد البشرية`,
    }),
    en: (p) => ({
      subject: 'Termination notice',
      text:
        `Dear ${p.name ?? ''},\n\n` +
        `This is the official notice of the end of your contractual relationship per the approved procedures. You will be contacted regarding your final settlement.\n\n` +
        `HR Department`,
    }),
  },

  /** HR — the employee completed the exit interview. */
  'hr.exit_interview_done': {
    ar: (p) => ({
      subject: `اكتملت مقابلة إنهاء الخدمة: ${p.name ?? ''}`,
      text: `أكمل الموظف ${p.name ?? ''} نموذج مقابلة إنهاء الخدمة. راجع النظام للاطلاع على الإجابات.`,
    }),
    en: (p) => ({
      subject: `Exit interview completed: ${p.name ?? ''}`,
      text: `Employee ${p.name ?? ''} completed the exit interview form. Review the answers in the system.`,
    }),
  },

  /** Employee — a custody form awaits their electronic approval. */
  'employee.asset_approval': {
    ar: (p) => ({
      subject: 'نموذج عهدة بانتظار اعتمادك',
      text:
        `مرحبًا ${p.name ?? ''},\n\n` +
        `تم إسناد عهدة جديدة إليك، ويلزم اعتمادها إلكترونيًا.` +
        (p.linkUrl ? `\n\nرابط الاعتماد: ${p.linkUrl}` : '') +
        `\n\nقسم الموارد البشرية`,
    }),
    en: (p) => ({
      subject: 'Asset custody form awaiting your approval',
      text:
        `Hello ${p.name ?? ''},\n\n` +
        `New assets have been assigned to you and require your electronic approval.` +
        (p.linkUrl ? `\n\nApproval link: ${p.linkUrl}` : '') +
        `\n\nHR Department`,
    }),
  },

  /** HR notice — the employee decided on a custody form. */
  'hr.asset_decided': {
    ar: (p) => ({
      subject: `قرار عهدة: ${p.name ?? ''}`,
      text: `قام الموظف ${p.name ?? ''} بالبت في نموذج العهدة. راجع النظام للتفاصيل.`,
    }),
    en: (p) => ({
      subject: `Asset custody decision: ${p.name ?? ''}`,
      text: `Employee ${p.name ?? ''} has decided on the custody form. Check the system for details.`,
    }),
  },

  /** HR notice — trainee approved the contract; employee profile created. */
  'hr.contract_approved': {
    ar: (p) => ({
      subject: `تم اعتماد العقد: ${p.name ?? ''}`,
      text: `اعتمد المتدرب ${p.name ?? ''} عقد العمل إلكترونيًا، وتم إنشاء ملف الموظف تلقائيًا ونقل جميع البيانات إليه.`,
    }),
    en: (p) => ({
      subject: `Contract approved: ${p.name ?? ''}`,
      text: `Trainee ${p.name ?? ''} approved the employment contract electronically. The employee profile was created automatically with all data transferred.`,
    }),
  },

  /** HR notice — a request expired (BRD: notify HR on Expired). */
  'hr.trainee_expired': {
    ar: (p) => ({
      subject: `انتهت مهلة طلب المتدرب ${p.name ?? ''}`,
      text: `انتهت المهلة المحددة لطلب المتدرب ${p.name ?? ''} وتم تغيير الحالة إلى Expired تلقائيًا. يمكن إعادة فتح الطلب من النظام.`,
    }),
    en: (p) => ({
      subject: `Trainee request expired: ${p.name ?? ''}`,
      text: `The deadline for trainee ${p.name ?? ''} has passed and the request was automatically set to Expired. It can be reopened from the system.`,
    }),
  },
};

export function renderTemplate(
  key: string,
  locale: Locale,
  params: TemplateParams,
): RenderedMessage {
  const variants = T[key];
  if (!variants) throw new Error(`unknown notification template: ${key}`);
  return variants[locale](params);
}
