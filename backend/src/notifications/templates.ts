/**
 * Bilingual notification templates. Every message exists in Arabic and
 * English; the recipient's locale picks the variant (new hires get Arabic by
 * default, staff get their UI language later).
 */
import { renderEmail, type EmailBlock } from './email-layout.js';

export type Locale = 'ar' | 'en';

export interface RenderedMessage {
  subject: string;
  /** Plain-text body — always produced. */
  text: string;
  /** Branded HTML alternative. Present on the messages a new hire receives
   *  (the ones carrying an action link); internal staff notices stay plain. */
  html?: string;
}

/**
 * Build both bodies from one definition so the text and HTML versions can
 * never drift apart — the plain text is derived from the same paragraphs the
 * HTML renders.
 */
function branded(
  locale: Locale,
  subject: string,
  block: EmailBlock,
  signOff: string,
): RenderedMessage {
  const text =
    block.paragraphs.join('\n\n') +
    (block.cta ? `\n\n${block.cta.label}: ${block.cta.url}` : '') +
    (block.note ? `\n\n${block.note}` : '') +
    `\n\n${signOff}`;

  return { subject, text, html: renderEmail(block, locale) };
}

const SIGN_OFF: Record<Locale, string> = {
  ar: 'قسم الموارد البشرية — Riyada HR',
  en: 'HR Department — Riyada HR',
};

const LINK_NOTE: Record<Locale, string> = {
  ar: 'الرابط صالح لفترة محدودة ومخصص لك وحدك، يُرجى عدم مشاركته.',
  en: 'This link is valid for a limited time and is personal to you — please do not share it.',
};

interface TemplateParams {
  name?: string;
  status?: string;
  daysWaiting?: number;
  daysLeft?: number;
  docType?: string;
  docNumber?: string;
  expiryDate?: string;
  linkUrl?: string;
}

type Template = (p: TemplateParams) => RenderedMessage;

const T: Record<string, Record<Locale, Template>> = {
  /**
   * FIRST send of the data form link — the first thing a new hire receives
   * from us, so it welcomes rather than chases.
   *
   * Kept separate from 'employee.form_reminder' on purpose: that one is fired
   * by the SLA watcher every day the form stays incomplete, and an email that
   * says "welcome" on the third chase reads as if nobody is paying attention.
   */
  'employee.form_invite': {
    ar: (p) =>
      branded(
        'ar',
        'نموذج استكمال بيانات الموظف — Riyada HR',
        {
          title: 'نموذج استكمال بيانات الموظف',
          paragraphs: [
            `مرحبًا ${p.name ?? ''},`,
            'نرحّب بك في ريادة. لاستكمال إجراءات التعيين، يُرجى تعبئة نموذج بيانات الموظف وإرفاق المستندات المطلوبة (صورة الهوية أو الإقامة، وصورة الآيبان البنكي).',
            'جميع الحقول إلزامية، ولن يستغرق النموذج سوى بضع دقائق.',
          ],
          ...(p.linkUrl ? { cta: { label: 'فتح النموذج', url: p.linkUrl } } : {}),
          note: LINK_NOTE.ar,
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        'Employee Information Form — Riyada HR',
        {
          title: 'Employee Information Form',
          paragraphs: [
            `Hello ${p.name ?? ''},`,
            'Welcome to Riyada. To complete your onboarding, please fill in the employee information form and attach the required documents (National ID / Iqama copy and your bank IBAN letter).',
            'All fields are required, and the form takes only a few minutes.',
          ],
          ...(p.linkUrl ? { cta: { label: 'Open the form', url: p.linkUrl } } : {}),
          note: LINK_NOTE.en,
        },
        SIGN_OFF.en,
      ),
  },

  /** 24h chase — the new hire still has not completed the data form. */
  'employee.form_reminder': {
    ar: (p) =>
      branded(
        'ar',
        'تذكير: استكمال نموذج بيانات الموظف — Riyada HR',
        {
          title: 'تذكير باستكمال النموذج',
          paragraphs: [
            `مرحبًا ${p.name ?? ''},`,
            'نذكّرك بأن نموذج بيانات الموظف لم يكتمل بعد. استكماله مطلوب لإتمام إجراءات التعيين وإعداد العقد.',
            ...(p.daysWaiting ? [`مضى على إرسال النموذج ${p.daysWaiting} يومًا.`] : []),
          ],
          ...(p.linkUrl ? { cta: { label: 'استكمال النموذج', url: p.linkUrl } } : {}),
          note: LINK_NOTE.ar,
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        'Reminder: complete your employee information form — Riyada HR',
        {
          title: 'Reminder to complete your form',
          paragraphs: [
            `Hello ${p.name ?? ''},`,
            'Your employee information form is still incomplete. We need it to finish your onboarding and prepare your contract.',
            ...(p.daysWaiting ? [`It has been ${p.daysWaiting} day(s) since the form was sent.`] : []),
          ],
          ...(p.linkUrl ? { cta: { label: 'Complete the form', url: p.linkUrl } } : {}),
          note: LINK_NOTE.en,
        },
        SIGN_OFF.en,
      ),
  },

  /** A tracked document is approaching (or past) its expiry date. */
  'staff.document_expiring': {
    ar: (p) => ({
      subject:
        (p.daysLeft ?? 0) < 0
          ? `منتهي: ${p.docType ?? 'مستند'} — ${p.name ?? ''}`
          : `ينتهي قريبًا: ${p.docType ?? 'مستند'} — ${p.name ?? ''}`,
      text:
        `${p.docType ?? 'المستند'}${p.docNumber ? ` رقم ${p.docNumber}` : ''} للموظف ${p.name ?? ''} ` +
        ((p.daysLeft ?? 0) < 0
          ? `انتهى بتاريخ ${p.expiryDate ?? ''} (منذ ${Math.abs(p.daysLeft ?? 0)} يومًا).`
          : `ينتهي بتاريخ ${p.expiryDate ?? ''} (بعد ${p.daysLeft ?? '?'} يومًا).`) +
        ` يرجى التجديد وتحديث التاريخ في النظام.`,
    }),
    en: (p) => ({
      subject:
        (p.daysLeft ?? 0) < 0
          ? `Expired: ${p.docType ?? 'document'} — ${p.name ?? ''}`
          : `Expiring soon: ${p.docType ?? 'document'} — ${p.name ?? ''}`,
      text:
        `${p.docType ?? 'The document'}${p.docNumber ? ` no. ${p.docNumber}` : ''} for ${p.name ?? ''} ` +
        ((p.daysLeft ?? 0) < 0
          ? `expired on ${p.expiryDate ?? ''} (${Math.abs(p.daysLeft ?? 0)} day(s) ago).`
          : `expires on ${p.expiryDate ?? ''} (in ${p.daysLeft ?? '?'} day(s)).`) +
        ` Please renew it and update the date in the system.`,
    }),
  },

  /** Escalation — the expiring document was ignored. */
  'staff.document_expiry_escalation': {
    ar: (p) => ({
      subject: `تصعيد: ${p.docType ?? 'مستند'} ${p.name ?? ''} — ${p.expiryDate ?? ''}`,
      text: `تصعيد تلقائي: ${p.docType ?? 'المستند'} للموظف ${p.name ?? ''} ينتهي/انتهى بتاريخ ${p.expiryDate ?? ''} رغم التذكيرات السابقة. يتطلب تدخلًا.`,
    }),
    en: (p) => ({
      subject: `Escalation: ${p.docType ?? 'document'} for ${p.name ?? ''} — ${p.expiryDate ?? ''}`,
      text: `Automatic escalation: the ${p.docType ?? 'document'} for ${p.name ?? ''} expires/expired on ${p.expiryDate ?? ''} despite earlier reminders. Intervention required.`,
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

  /** Daily reminder — contract awaiting the new hire's approval. */
  'employee.contract_approval_reminder': {
    ar: (p) =>
      branded(
        'ar',
        'اعتماد عقد العمل — Riyada HR',
        {
          title: 'عقد العمل بانتظار اعتمادك',
          paragraphs: [
            `مرحبًا ${p.name ?? ''},`,
            'تم إعداد عقد العمل الخاص بك، وهو الآن بانتظار اطّلاعك واعتماده إلكترونيًا.',
          ],
          ...(p.linkUrl ? { cta: { label: 'مراجعة العقد واعتماده', url: p.linkUrl } } : {}),
          note: LINK_NOTE.ar,
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        'Approve your employment contract — Riyada HR',
        {
          title: 'Your contract is awaiting approval',
          paragraphs: [
            `Hello ${p.name ?? ''},`,
            'Your employment contract has been prepared and is now awaiting your review and electronic approval.',
          ],
          ...(p.linkUrl ? { cta: { label: 'Review and approve', url: p.linkUrl } } : {}),
          note: LINK_NOTE.en,
        },
        SIGN_OFF.en,
      ),
  },

  /** Employee — exit interview form (auto-sent for resignations, BRD). */
  'employee.exit_interview': {
    ar: (p) =>
      branded(
        'ar',
        'نموذج مقابلة إنهاء الخدمة — Riyada HR',
        {
          title: 'نموذج مقابلة إنهاء الخدمة',
          paragraphs: [
            `مرحبًا ${p.name ?? ''},`,
            'نشكرك على الفترة التي قضيتها معنا. نرجو تخصيص بضع دقائق لاستكمال نموذج مقابلة إنهاء الخدمة؛ ملاحظاتك تساعدنا على التحسين.',
          ],
          ...(p.linkUrl ? { cta: { label: 'فتح النموذج', url: p.linkUrl } } : {}),
          note: LINK_NOTE.ar,
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        'Exit interview form — Riyada HR',
        {
          title: 'Exit interview form',
          paragraphs: [
            `Hello ${p.name ?? ''},`,
            'Thank you for the time you spent with us. Please take a few minutes to complete the exit interview form — your feedback helps us improve.',
          ],
          ...(p.linkUrl ? { cta: { label: 'Open the form', url: p.linkUrl } } : {}),
          note: LINK_NOTE.en,
        },
        SIGN_OFF.en,
      ),
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
    ar: (p) =>
      branded(
        'ar',
        'نموذج عهدة بانتظار اعتمادك — Riyada HR',
        {
          title: 'نموذج عهدة بانتظار اعتمادك',
          paragraphs: [
            `مرحبًا ${p.name ?? ''},`,
            'تم إسناد عهدة جديدة إليك. يُرجى مراجعة تفاصيل العهدة واعتمادها إلكترونيًا.',
          ],
          ...(p.linkUrl ? { cta: { label: 'مراجعة العهدة واعتمادها', url: p.linkUrl } } : {}),
          note: LINK_NOTE.ar,
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        'Asset custody form awaiting your approval — Riyada HR',
        {
          title: 'Asset custody awaiting your approval',
          paragraphs: [
            `Hello ${p.name ?? ''},`,
            'New assets have been assigned to you. Please review the custody details and approve them electronically.',
          ],
          ...(p.linkUrl ? { cta: { label: 'Review and approve', url: p.linkUrl } } : {}),
          note: LINK_NOTE.en,
        },
        SIGN_OFF.en,
      ),
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

  /** HR notice — the new hire approved the contract; employee activated. */
  'hr.contract_approved': {
    ar: (p) => ({
      subject: `تم اعتماد العقد: ${p.name ?? ''}`,
      text: `اعتمد ${p.name ?? ''} عقد العمل إلكترونيًا، وتم تفعيل ملف الموظف وتخصيص الرقم الوظيفي تلقائيًا.`,
    }),
    en: (p) => ({
      subject: `Contract approved: ${p.name ?? ''}`,
      text: `${p.name ?? ''} approved the employment contract electronically. The employee file was activated and an employee number was assigned automatically.`,
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
