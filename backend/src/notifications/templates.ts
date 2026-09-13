/**
 * Bilingual notification templates — the HR memo's table of events, in code.
 *
 * Every message exists in Arabic and English; the recipient's language picks
 * the variant (each employee's preferred language, staff their UI language).
 * Employee-facing messages carry the personal signed link they need (form,
 * contract, custody). Staff-facing messages carry a link to the employee's
 * file, so nobody has to search for the record the email is about.
 *
 * Admins may override any of these from Email templates; what lives here is
 * the default wording, taken from the memo as closely as the format allows.
 */
import { renderEmail, type EmailBlock } from './email-layout.js';

export type Locale = 'ar' | 'en';

export interface RenderedMessage {
  subject: string;
  /** Plain-text body — always produced. */
  text: string;
  /** Branded HTML alternative. */
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
    (block.details?.length
      ? `\n\n${block.details.map((row) => `${row.label}: ${row.value}`).join('\n')}`
      : '') +
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

const OPEN_FILE: Record<Locale, string> = { ar: 'فتح ملف الموظف', en: 'Open the employee file' };

export interface TemplateParams {
  name?: string;
  employeeNo?: string;
  department?: string;
  jobTitle?: string;
  status?: string;
  daysWaiting?: number;
  daysLeft?: number;
  docType?: string;
  docNumber?: string;
  expiryDate?: string;
  /** The personal signed link an employee-facing message needs. */
  linkUrl?: string;
  /** Admin-created templates: a fresh data-form link for the employee. */
  formLink?: string;
  /** Staff-facing messages: the employee's file in the system. */
  employeeLink?: string;
  /** What HR asked the trainee to complete or correct. */
  missingItems?: string;
  /** Contract terms as recorded by HR, and the employee's personal link to them. */
  contractSalary?: string;
  contractDuration?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  contractTerms?: string;
  contractRef?: string;
  contractLink?: string;
  /** Why a contract or custody form was sent back. */
  rejectReason?: string;
  /** Staff invitation only. */
  email?: string;
  tempPassword?: string;
}

type Template = (p: TemplateParams) => RenderedMessage;

/** Contract terms as label/value rows; anything HR left blank is skipped. */
function contractRows(p: TemplateParams, locale: Locale): Array<{ label: string; value: string }> {
  const L =
    locale === 'ar'
      ? {
          salary: 'الراتب',
          duration: 'مدة العقد',
          months: (n: string) => `${n} شهرًا`,
          start: 'تاريخ المباشرة',
          end: 'تاريخ الانتهاء',
          ref: 'رقم العقد',
          terms: 'بنود إضافية',
        }
      : {
          salary: 'Salary',
          duration: 'Duration',
          months: (n: string) => `${n} month(s)`,
          start: 'Start date',
          end: 'End date',
          ref: 'Contract reference',
          terms: 'Additional terms',
        };
  const rows: Array<{ label: string; value: string }> = [];
  if (p.contractSalary) rows.push({ label: L.salary, value: p.contractSalary });
  if (p.contractDuration) rows.push({ label: L.duration, value: L.months(p.contractDuration) });
  if (p.contractStartDate) rows.push({ label: L.start, value: p.contractStartDate });
  if (p.contractEndDate) rows.push({ label: L.end, value: p.contractEndDate });
  if (p.contractRef) rows.push({ label: L.ref, value: p.contractRef });
  if (p.contractTerms) rows.push({ label: L.terms, value: p.contractTerms });
  return rows;
}

/** The contract page link, falling back to whatever link the sender supplied. */
function contractCta(p: TemplateParams): string | undefined {
  return p.contractLink ?? p.linkUrl;
}

/** An employee-facing message: greeting, body, personal link, privacy note. */
function toEmployee(
  locale: Locale,
  subject: string,
  title: string,
  paragraphs: string[],
  link: { label: string; url: string | undefined },
  details?: Array<{ label: string; value: string }>,
): RenderedMessage {
  return branded(
    locale,
    subject,
    {
      title,
      paragraphs,
      ...(details?.length ? { details } : {}),
      ...(link.url ? { cta: { label: link.label, url: link.url }, note: LINK_NOTE[locale] } : {}),
    },
    SIGN_OFF[locale],
  );
}

/** A staff-facing notice: what happened, and a button to the employee's file. */
function toStaff(
  locale: Locale,
  subject: string,
  paragraphs: string[],
  p: TemplateParams,
  details?: Array<{ label: string; value: string }>,
): RenderedMessage {
  return branded(
    locale,
    subject,
    {
      title: subject,
      paragraphs,
      ...(details?.length ? { details } : {}),
      ...(p.employeeLink ? { cta: { label: OPEN_FILE[locale], url: p.employeeLink } } : {}),
    },
    SIGN_OFF[locale],
  );
}

const hello = (locale: Locale, p: TemplateParams) =>
  locale === 'ar' ? `أهلًا ${p.name ?? ''}،` : `Hello ${p.name ?? ''},`;

const T: Record<string, Record<Locale, Template>> = {
  // ────────────────────────────────────────── 1. the data form goes out
  'employee.form_invite': {
    ar: (p) =>
      toEmployee(
        'ar',
        'أهلًا بك في ريادة | استكمال بيانات التوظيف',
        'أهلًا بك في ريادة',
        [
          hello('ar', p),
          'أهلًا وسهلًا بك، يسعدنا انضمامك إلى فريق العمل، ونتمنى لك بداية موفقة ومسيرة مليئة بالنجاح.',
          'لاستكمال إجراءات التوظيف، نرجو تعبئة البيانات المطلوبة وإرفاق المستندات من خلال الرابط التالي.',
          'وفي حال وجود أي استفسار يمكنك التواصل معنا في أي وقت.',
        ],
        { label: 'فتح النموذج', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Welcome to Riyada | Complete your employment details',
        'Welcome to Riyada',
        [
          hello('en', p),
          'Welcome aboard. We are delighted to have you join the team and wish you a great start and a successful journey with us.',
          'To complete your onboarding, please fill in the required details and attach your documents through the link below.',
          'If you have any questions, you can reach us at any time.',
        ],
        { label: 'Open the form', url: p.linkUrl },
      ),
  },

  // ────────────────────────────────────────── 2. form not completed (24h)
  'employee.form_reminder': {
    ar: (p) =>
      toEmployee(
        'ar',
        'تذكير باستكمال بيانات التوظيف',
        'تذكير باستكمال بيانات التوظيف',
        [
          hello('ar', p),
          'نود تذكيرك بأن نموذج استكمال بيانات التوظيف لا يزال بانتظار استكمالك. نرجو تعبئة البيانات ورفع المستندات المطلوبة من خلال الرابط التالي.',
          'شاكرين لك تعاونك، ونتمنى لك كل التوفيق.',
        ],
        { label: 'استكمال النموذج', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Reminder: complete your employment details',
        'Reminder to complete your details',
        [
          hello('en', p),
          'A reminder that your employment details form is still waiting to be completed. Please fill in the details and upload the required documents through the link below.',
          'Thank you for your cooperation, and all the best.',
        ],
        { label: 'Complete the form', url: p.linkUrl },
      ),
  },
  'staff.form_pending': {
    ar: (p) =>
      toStaff(
        'ar',
        `تذكير باستكمال بيانات التوظيف – ${p.name ?? ''}`,
        [
          `نموذج استكمال بيانات التوظيف للمتدرب ${p.name ?? ''} لا يزال بانتظار الاستكمال` +
            (p.daysWaiting ? ` منذ ${p.daysWaiting} يومًا` : '') +
            '. تم إرسال تذكير للمتدرب.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Reminder: employment details pending – ${p.name ?? ''}`,
        [
          `The employment details form for ${p.name ?? ''} is still incomplete` +
            (p.daysWaiting ? ` after ${p.daysWaiting} day(s)` : '') +
            '. A reminder has been sent to the trainee.',
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 3. form submitted
  'hr.form_submitted': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم استكمال بيانات المتدرب – ${p.name ?? ''}`,
        [
          `قام المتدرب ${p.name ?? ''} باستكمال نموذج البيانات ورفع المستندات المطلوبة. نرجو الاطلاع واستكمال الإجراء التالي.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Trainee details completed – ${p.name ?? ''}`,
        [
          `${p.name ?? ''} has completed the details form and uploaded the required documents. Please review and proceed with the next step.`,
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 4. something is missing
  'employee.form_missing': {
    ar: (p) =>
      toEmployee(
        'ar',
        'استكمال البيانات أو المستندات المطلوبة',
        'استكمال البيانات أو المستندات المطلوبة',
        [
          hello('ar', p),
          'شكرًا لك على استكمال نموذج بيانات التوظيف. نحتاج منك استكمال أو تحديث البيانات أو المستندات التالية:',
          ...(p.missingItems ? [p.missingItems] : []),
          'يمكنك استكمال المطلوب من خلال الرابط التالي. شاكرين لك تعاونك.',
        ],
        { label: 'استكمال المطلوب', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Details or documents still required',
        'Details or documents still required',
        [
          hello('en', p),
          'Thank you for completing the employment details form. We need you to complete or update the following:',
          ...(p.missingItems ? [p.missingItems] : []),
          'You can do so through the link below. Thank you for your cooperation.',
        ],
        { label: 'Complete the missing items', url: p.linkUrl },
      ),
  },
  'staff.form_missing': {
    ar: (p) =>
      toStaff(
        'ar',
        `طلب استكمال نواقص – ${p.name ?? ''}`,
        [
          `تم إرسال طلب إلى المتدرب ${p.name ?? ''} لاستكمال البيانات أو المستندات التالية:`,
          ...(p.missingItems ? [p.missingItems] : []),
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Missing items requested – ${p.name ?? ''}`,
        [
          `${p.name ?? ''} has been asked to complete or update the following:`,
          ...(p.missingItems ? [p.missingItems] : []),
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 5. form deadline passed (10 days)
  'staff.form_expired': {
    ar: (p) =>
      toStaff(
        'ar',
        `انتهاء مهلة استكمال البيانات – ${p.name ?? ''}`,
        [
          `انتهت المهلة المحددة للمتدرب ${p.name ?? ''} دون استكمال البيانات والمستندات المطلوبة، وتم تحديث الحالة تلقائيًا إلى Expired.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Details deadline expired – ${p.name ?? ''}`,
        [
          `The deadline for ${p.name ?? ''} passed without the required details and documents being completed. The status was updated to Expired automatically.`,
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 6. documents accepted → contract
  'hr.ready_for_contract': {
    ar: (p) =>
      toStaff(
        'ar',
        `جاهز لإنشاء عقد العمل – ${p.name ?? ''}`,
        [`تم استكمال بيانات ومستندات المتدرب ${p.name ?? ''} وأصبح الملف جاهزًا لإنشاء عقد العمل.`],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Ready for contract creation – ${p.name ?? ''}`,
        [`The details and documents for ${p.name ?? ''} are complete and the file is ready for the employment contract.`],
        p,
      ),
  },

  // ────────────────────────────────────────── 7. contract not created (2 working days)
  'staff.contract_pending_creation': {
    ar: (p) =>
      toStaff(
        'ar',
        'تذكير – عقد بانتظار الإنشاء',
        [
          `عقد المتدرب ${p.name ?? ''} لا يزال بانتظار الإنشاء بعد مرور المهلة المحددة (يومي عمل). نرجو استكمال الإجراء وتحديث الحالة.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        'Reminder – contract awaiting creation',
        [
          `The contract for ${p.name ?? ''} is still awaiting creation past the agreed window (two working days). Please complete the step and update the status.`,
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 8. contract issued
  'employee.contract_ready': {
    ar: (p) =>
      toEmployee(
        'ar',
        'عقد العمل بانتظار موافقتك',
        'عقد العمل بانتظار موافقتك',
        [
          hello('ar', p),
          'يسعدنا إبلاغك بأنه تم إصدار عقد العمل الخاص بك. نرجو مراجعة العقد والموافقة عليه لاستكمال إجراءات الانضمام.',
          'نتمنى لك بداية موفقة، ونسعد بانضمامك إلى فريق العمل.',
        ],
        { label: 'مراجعة العقد والموافقة عليه', url: contractCta(p) },
        contractRows(p, 'ar'),
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Your employment contract awaits your approval',
        'Your employment contract awaits your approval',
        [
          hello('en', p),
          'We are pleased to let you know that your employment contract has been issued. Please review it and give your approval to complete your onboarding.',
          'We wish you a great start and are glad to have you on the team.',
        ],
        { label: 'Review and approve the contract', url: contractCta(p) },
        contractRows(p, 'en'),
      ),
  },

  // ────────────────────────────────────────── 9. contract not approved (5 working days, then daily)
  'employee.contract_approval_reminder': {
    ar: (p) =>
      toEmployee(
        'ar',
        'تذكير – عقد العمل بانتظار الموافقة',
        'تذكير – عقد العمل بانتظار الموافقة',
        [
          hello('ar', p),
          'نود تذكيرك بأن عقد العمل الخاص بك لا يزال بانتظار الموافقة. نرجو مراجعة العقد واستكمال الإجراء.',
        ],
        { label: 'مراجعة العقد والموافقة عليه', url: contractCta(p) },
        contractRows(p, 'ar'),
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Reminder – your employment contract awaits approval',
        'Reminder – your employment contract awaits approval',
        [
          hello('en', p),
          'A reminder that your employment contract is still awaiting your approval. Please review it and complete the step.',
        ],
        { label: 'Review and approve the contract', url: contractCta(p) },
        contractRows(p, 'en'),
      ),
  },
  'staff.contract_approval_pending': {
    ar: (p) =>
      toStaff(
        'ar',
        `تذكير – عقد العمل بانتظار الموافقة – ${p.name ?? ''}`,
        [
          `عقد العمل للمتدرب ${p.name ?? ''} لا يزال بانتظار الموافقة` +
            (p.daysWaiting ? ` منذ ${p.daysWaiting} يومًا` : '') +
            '. تم إرسال تذكير للمتدرب.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Reminder – contract awaiting approval – ${p.name ?? ''}`,
        [
          `The employment contract for ${p.name ?? ''} is still awaiting approval` +
            (p.daysWaiting ? ` after ${p.daysWaiting} day(s)` : '') +
            '. A reminder has been sent to the trainee.',
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 10. approval deadline passed (10 days)
  'staff.contract_approval_expired': {
    ar: (p) =>
      toStaff(
        'ar',
        `انتهاء مهلة الموافقة على العقد – ${p.name ?? ''}`,
        [
          `انتهت المهلة المحددة للموافقة على عقد المتدرب ${p.name ?? ''} دون اعتماد العقد، وتم تحديث الحالة إلى Expired. نرجو الاطلاع واتخاذ الإجراء المناسب.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Contract approval deadline expired – ${p.name ?? ''}`,
        [
          `The approval window for ${p.name ?? ''}'s contract passed without approval, and the status was updated to Expired. Please review and take the appropriate action.`,
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 11. contract → Active
  'hr.contract_status_active': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم تحديث حالة العقد – ${p.name ?? ''}`,
        [`تم تحديث حالة عقد ${p.name ?? ''} إلى Active، ويمكن استكمال إجراءات تحويله إلى موظف فعال.`],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Contract status updated – ${p.name ?? ''}`,
        [`The contract for ${p.name ?? ''} is now Active. The remaining steps to make them an active employee can proceed.`],
        p,
      ),
  },

  // ────────────────────────────────────────── 12. contract rejected
  'hr.contract_rejected': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم رفض العقد – ${p.name ?? ''}`,
        [
          `تم تحديث حالة عقد ${p.name ?? ''} إلى Rejected.` +
            (p.rejectReason ? ` سبب الرفض: ${p.rejectReason}.` : '') +
            ' نرجو الاطلاع واتخاذ الإجراء المناسب.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Contract rejected – ${p.name ?? ''}`,
        [
          `The contract for ${p.name ?? ''} was updated to Rejected.` +
            (p.rejectReason ? ` Reason: ${p.rejectReason}.` : '') +
            ' Please review and take the appropriate action.',
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 13. trainee → employee
  'hr.employee_activated': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم إنشاء ملف الموظف – ${p.name ?? ''}`,
        [`تم استكمال إجراءات التعاقد للموظف ${p.name ?? ''} وإنشاء ملفه الوظيفي بحالة Active.`],
        p,
        p.employeeNo ? [{ label: 'الرقم الوظيفي', value: p.employeeNo }] : undefined,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Employee file created – ${p.name ?? ''}`,
        [`Contracting for ${p.name ?? ''} is complete and their employee file has been created with status Active.`],
        p,
        p.employeeNo ? [{ label: 'Employee number', value: p.employeeNo }] : undefined,
      ),
  },

  // ────────────────────────────────────────── 14. custody form sent
  'employee.asset_approval': {
    ar: (p) =>
      toEmployee(
        'ar',
        'اعتماد استلام العهدة',
        'اعتماد استلام العهدة',
        [
          hello('ar', p),
          'نرجو مراجعة تفاصيل العهد المسلمة لك واعتماد الاستلام من خلال الرابط التالي. شاكرين لك تعاونك.',
        ],
        { label: 'مراجعة العهدة واعتمادها', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Confirm receipt of your assets',
        'Confirm receipt of your assets',
        [
          hello('en', p),
          'Please review the details of the assets handed to you and confirm receipt through the link below. Thank you for your cooperation.',
        ],
        { label: 'Review and confirm', url: p.linkUrl },
      ),
  },

  // ────────────────────────────────────────── 15. custody not decided (24h)
  'employee.asset_reminder': {
    ar: (p) =>
      toEmployee(
        'ar',
        'تذكير – نموذج العهدة بانتظار الاعتماد',
        'تذكير – نموذج العهدة بانتظار الاعتماد',
        [
          hello('ar', p),
          'نود تذكيرك بأن نموذج العهدة لا يزال بانتظار اعتمادك. نرجو مراجعة تفاصيل العهد واستكمال الإجراء من خلال الرابط التالي.',
        ],
        { label: 'مراجعة العهدة واعتمادها', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Reminder – your custody form awaits confirmation',
        'Reminder – your custody form awaits confirmation',
        [
          hello('en', p),
          'A reminder that your asset custody form is still awaiting your confirmation. Please review the details and complete the step through the link below.',
        ],
        { label: 'Review and confirm', url: p.linkUrl },
      ),
  },
  'staff.asset_pending': {
    ar: (p) =>
      toStaff(
        'ar',
        `تذكير – نموذج العهدة بانتظار الاعتماد – ${p.name ?? ''}`,
        [
          `نموذج العهدة للموظف ${p.name ?? ''} لا يزال بانتظار اعتماده` +
            (p.daysWaiting ? ` منذ ${p.daysWaiting} يومًا` : '') +
            '. تم إرسال تذكير للموظف.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Reminder – custody form awaiting confirmation – ${p.name ?? ''}`,
        [
          `The custody form for ${p.name ?? ''} is still awaiting their confirmation` +
            (p.daysWaiting ? ` after ${p.daysWaiting} day(s)` : '') +
            '. A reminder has been sent to the employee.',
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── 16 / 17. custody decided
  'hr.asset_approved': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم اعتماد نموذج العهدة – ${p.name ?? ''}`,
        [
          `قام الموظف ${p.name ?? ''} باعتماد نموذج العهدة، وتم تحديث حالة الطلب إلى Approved وربط العهد بملف الموظف.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Custody form confirmed – ${p.name ?? ''}`,
        [
          `${p.name ?? ''} has confirmed the custody form. The request is now Approved and the assets are linked to the employee's file.`,
        ],
        p,
      ),
  },
  'hr.asset_rejected': {
    ar: (p) =>
      toStaff(
        'ar',
        `تم رفض نموذج العهدة – ${p.name ?? ''}`,
        [
          `قام الموظف ${p.name ?? ''} برفض نموذج العهدة.` +
            (p.rejectReason ? ` السبب: ${p.rejectReason}.` : '') +
            ' نرجو مراجعة الطلب واتخاذ الإجراء اللازم.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Custody form rejected – ${p.name ?? ''}`,
        [
          `${p.name ?? ''} has rejected the custody form.` +
            (p.rejectReason ? ` Reason: ${p.rejectReason}.` : '') +
            ' Please review the request and take the necessary action.',
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── generic automation notices
  /** Generic staff reminder — any record stalled in any watched status. */
  'staff.record_stalled': {
    ar: (p) =>
      toStaff(
        'ar',
        `متابعة: ${p.name ?? ''} — ${p.status ?? ''}`,
        [`السجل الخاص بـ ${p.name ?? ''} في حالة ${p.status ?? ''} منذ ${p.daysWaiting ?? '?'} يومًا. يرجى المتابعة.`],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Follow-up: ${p.name ?? ''} — ${p.status ?? ''}`,
        [`The record for ${p.name ?? ''} has been in status ${p.status ?? ''} for ${p.daysWaiting ?? '?'} day(s). Please follow up.`],
        p,
      ),
  },

  /** Escalation — reminders were ignored; a higher group steps in. */
  'staff.escalation': {
    ar: (p) =>
      toStaff(
        'ar',
        `تصعيد: ${p.name ?? ''} متوقف منذ ${p.daysWaiting ?? '?'} يومًا`,
        [
          `تصعيد تلقائي: سجل ${p.name ?? ''} لا يزال في حالة ${p.status ?? ''} منذ ${p.daysWaiting ?? '?'} يومًا رغم التذكيرات السابقة. يتطلب تدخلًا.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Escalation: ${p.name ?? ''} stalled for ${p.daysWaiting ?? '?'} day(s)`,
        [
          `Automatic escalation: the record for ${p.name ?? ''} is still in status ${p.status ?? ''} after ${p.daysWaiting ?? '?'} day(s) despite earlier reminders. Intervention required.`,
        ],
        p,
      ),
  },

  /** A deadline expired and the system closed the window (generic wording). */
  'staff.record_expired': {
    ar: (p) =>
      toStaff(
        'ar',
        `انتهت المهلة: ${p.name ?? ''}`,
        [`انتهت المهلة المحددة لسجل ${p.name ?? ''} (الحالة: ${p.status ?? ''}) وتم تغييرها تلقائيًا. يمكن إعادة الفتح من النظام.`],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Deadline expired: ${p.name ?? ''}`,
        [`The deadline for ${p.name ?? ''} (status: ${p.status ?? ''}) has passed and was changed automatically. It can be reopened from the system.`],
        p,
      ),
  },

  /** A tracked document is approaching (or past) its expiry date. */
  'staff.document_expiring': {
    ar: (p) =>
      toStaff(
        'ar',
        (p.daysLeft ?? 0) < 0
          ? `منتهي: ${p.docType ?? 'مستند'} — ${p.name ?? ''}`
          : `ينتهي قريبًا: ${p.docType ?? 'مستند'} — ${p.name ?? ''}`,
        [
          `${p.docType ?? 'المستند'}${p.docNumber ? ` رقم ${p.docNumber}` : ''} للموظف ${p.name ?? ''} ` +
            ((p.daysLeft ?? 0) < 0
              ? `انتهى بتاريخ ${p.expiryDate ?? ''} (منذ ${Math.abs(p.daysLeft ?? 0)} يومًا).`
              : `ينتهي بتاريخ ${p.expiryDate ?? ''} (بعد ${p.daysLeft ?? '?'} يومًا).`) +
            ' يرجى التجديد وتحديث التاريخ في النظام.',
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        (p.daysLeft ?? 0) < 0
          ? `Expired: ${p.docType ?? 'document'} — ${p.name ?? ''}`
          : `Expiring soon: ${p.docType ?? 'document'} — ${p.name ?? ''}`,
        [
          `${p.docType ?? 'The document'}${p.docNumber ? ` no. ${p.docNumber}` : ''} for ${p.name ?? ''} ` +
            ((p.daysLeft ?? 0) < 0
              ? `expired on ${p.expiryDate ?? ''} (${Math.abs(p.daysLeft ?? 0)} day(s) ago).`
              : `expires on ${p.expiryDate ?? ''} (in ${p.daysLeft ?? '?'} day(s)).`) +
            ' Please renew it and update the date in the system.',
        ],
        p,
      ),
  },

  /** Escalation — the expiring document was ignored. */
  'staff.document_expiry_escalation': {
    ar: (p) =>
      toStaff(
        'ar',
        `تصعيد: ${p.docType ?? 'مستند'} ${p.name ?? ''} — ${p.expiryDate ?? ''}`,
        [
          `تصعيد تلقائي: ${p.docType ?? 'المستند'} للموظف ${p.name ?? ''} ينتهي/انتهى بتاريخ ${p.expiryDate ?? ''} رغم التذكيرات السابقة. يتطلب تدخلًا.`,
        ],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Escalation: ${p.docType ?? 'document'} for ${p.name ?? ''} — ${p.expiryDate ?? ''}`,
        [
          `Automatic escalation: the ${p.docType ?? 'document'} for ${p.name ?? ''} expires/expired on ${p.expiryDate ?? ''} despite earlier reminders. Intervention required.`,
        ],
        p,
      ),
  },

  // ────────────────────────────────────────── offboarding
  /** Employee — exit interview form (auto-sent for resignations, BRD). */
  'employee.exit_interview': {
    ar: (p) =>
      toEmployee(
        'ar',
        'نموذج مقابلة إنهاء الخدمة',
        'نموذج مقابلة إنهاء الخدمة',
        [
          hello('ar', p),
          'نشكرك على الفترة التي قضيتها معنا. نرجو تخصيص بضع دقائق لاستكمال نموذج مقابلة إنهاء الخدمة؛ ملاحظاتك تساعدنا على التحسين.',
        ],
        { label: 'فتح النموذج', url: p.linkUrl },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Exit interview form',
        'Exit interview form',
        [
          hello('en', p),
          'Thank you for the time you spent with us. Please take a few minutes to complete the exit interview form — your feedback helps us improve.',
        ],
        { label: 'Open the form', url: p.linkUrl },
      ),
  },

  /** Employee — official termination notice (BRD step 3). */
  'employee.termination_notice': {
    ar: (p) =>
      toEmployee(
        'ar',
        'إشعار إنهاء الخدمة',
        'إشعار إنهاء الخدمة',
        [
          `عزيزنا ${p.name ?? ''}،`,
          'نشعركم بإنهاء العلاقة التعاقدية وفق الإجراءات المعتمدة. سيتم التواصل معكم بخصوص المخالصة النهائية.',
        ],
        { label: '', url: undefined },
      ),
    en: (p) =>
      toEmployee(
        'en',
        'Termination notice',
        'Termination notice',
        [
          `Dear ${p.name ?? ''},`,
          'This is the official notice of the end of your contractual relationship per the approved procedures. You will be contacted regarding your final settlement.',
        ],
        { label: '', url: undefined },
      ),
  },

  /** HR — the employee completed the exit interview. */
  'hr.exit_interview_done': {
    ar: (p) =>
      toStaff(
        'ar',
        `اكتملت مقابلة إنهاء الخدمة – ${p.name ?? ''}`,
        [`أكمل الموظف ${p.name ?? ''} نموذج مقابلة إنهاء الخدمة. يمكن الاطلاع على الإجابات من ملفه.`],
        p,
      ),
    en: (p) =>
      toStaff(
        'en',
        `Exit interview completed – ${p.name ?? ''}`,
        [`${p.name ?? ''} completed the exit interview form. The answers are on their file.`],
        p,
      ),
  },

  // ────────────────────────────────────────── system
  /**
   * Staff account invitation — the sign-in link plus a temporary password.
   * The system forces a new password at first sign-in, so the temporary one
   * is only ever good for that single step.
   */
  'staff.invitation': {
    ar: (p) =>
      branded('ar', 'دعوتك إلى نظام الموارد البشرية — Riyada HR', {
        title: 'حسابك في نظام الموارد البشرية جاهز',
        paragraphs: [
          `مرحبًا ${p.name ?? ''},`,
          'تم إنشاء حساب لك في نظام الموارد البشرية بشركة ريادة. بيانات الدخول المؤقتة:',
          `البريد الإلكتروني: ${p.email ?? ''}`,
          `كلمة المرور المؤقتة: ${p.tempPassword ?? ''}`,
          'عند أول تسجيل دخول سيُطلب منك اختيار كلمة مرور خاصة بك قبل المتابعة.',
        ],
        ...(p.linkUrl ? { cta: { label: 'تسجيل الدخول', url: p.linkUrl } } : {}),
        note: 'هذه الرسالة مخصصة لك وحدك — لا تشاركها مع أي شخص.',
      }, SIGN_OFF.ar),
    en: (p) =>
      branded('en', 'Your Riyada HR account is ready', {
        title: 'Your HR system account is ready',
        paragraphs: [
          `Hello ${p.name ?? ''},`,
          'An account has been created for you on the Riyada HR system. Your temporary sign-in details:',
          `Email: ${p.email ?? ''}`,
          `Temporary password: ${p.tempPassword ?? ''}`,
          'The first time you sign in you will be asked to choose your own password before continuing.',
        ],
        ...(p.linkUrl ? { cta: { label: 'Sign in', url: p.linkUrl } } : {}),
        note: 'This message is personal to you — please do not share it.',
      }, SIGN_OFF.en),
  },

  /**
   * Generic status-change notice for admin-defined triggers. Works out of the
   * box; admins usually replace the wording per trigger in Email templates.
   */
  'custom.status_change': {
    ar: (p) =>
      branded(
        'ar',
        `تحديث حالة: ${p.name ?? ''} — ${p.status ?? ''}`,
        {
          title: 'تحديث حالة',
          paragraphs: [`انتقل سجل ${p.name ?? ''} إلى الحالة «${p.status ?? ''}».`],
        },
        SIGN_OFF.ar,
      ),
    en: (p) =>
      branded(
        'en',
        `Status update: ${p.name ?? ''} — ${p.status ?? ''}`,
        {
          title: 'Status update',
          paragraphs: [`The record for ${p.name ?? ''} moved to status "${p.status ?? ''}".`],
        },
        SIGN_OFF.en,
      ),
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
