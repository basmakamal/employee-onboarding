import 'package:flutter/widgets.dart';

/// Bilingual strings. Arabic is the default, matching the web app, and RTL is
/// therefore the primary layout direction rather than an afterthought.
///
/// Deliberately a plain map for now: the string set is small and every value
/// is reviewed by HR. Move to ARB + gen_l10n when translators need tooling.
class S {
  const S(this.locale);

  final Locale locale;

  static const supported = [Locale('ar'), Locale('en')];

  static S of(BuildContext context) => S(Localizations.localeOf(context));

  bool get isAr => locale.languageCode == 'ar';

  String _(String ar, String en) => isAr ? ar : en;

  // ── auth
  String get appName => _('نظام الموارد البشرية', 'HR System');
  String get signIn => _('تسجيل الدخول', 'Sign in');
  String get email => _('البريد الإلكتروني', 'Email');
  String get password => _('كلمة المرور', 'Password');
  String get signInFailed =>
      _('تعذّر تسجيل الدخول. تحقّق من البريد وكلمة المرور.',
        'Sign-in failed. Check your email and password.');
  String get signOut => _('تسجيل الخروج', 'Sign out');

  // ── nav
  String get tabHome => _('الرئيسية', 'Home');
  String get tabWork => _('المهام', 'Work');
  String get tabDirectory => _('الموظفون', 'Directory');
  String get tabInbox => _('الإشعارات', 'Inbox');
  String get tabMore => _('المزيد', 'More');

  // ── work queue
  String get work => _('المهام', 'Work');
  String recordsNeedYou(int n) =>
      isAr ? '$n سجلاً بانتظارك' : '$n records need you';
  String get bucketOverdue => _('متأخر', 'Overdue');
  String get bucketToday => _('مستحق اليوم', 'Due today');
  String get bucketWeek => _('هذا الأسبوع', 'This week');
  String get bucketLater => _('لاحقًا', 'Later');
  String get all => _('الكل', 'All');
  String ageDays(int n) => isAr ? 'منذ $n يوم' : '${n}d in status';
  String dueInDays(int n) => isAr ? 'يستحق خلال $n يوم' : 'due in ${n}d';
  String get queueEmpty => _('لا توجد مهام بانتظارك', 'Nothing needs you');
  String get queueEmptyHint =>
      _('كل السجلات ضمن المهلة المحددة.', 'Every record is within its SLA.');

  // ── machines
  String kind(String key) {
    switch (key) {
      case 'EMPLOYEE':
        return _('التوظيف', 'Onboarding');
      case 'GOSI':
        return _('التأمينات الاجتماعية', 'GOSI');
      case 'MEDICAL_INSURANCE':
        return _('التأمين الطبي', 'Medical insurance');
      case 'CRIMINAL_RECORD':
        return _('خلو السوابق', 'Criminal record');
      case 'ASSET_FORM':
        return _('العهد', 'Asset custody');
      case 'OFFBOARDING':
        return _('إنهاء العلاقة', 'Offboarding');
      default:
        return key;
    }
  }

  /// Statuses read as short chips; unknown values fall back to the raw enum
  /// rather than showing a blank.
  String status(String key) {
    switch (key) {
      case 'CREATED':
        return _('جديد', 'Created');
      case 'AWAITING_FORM':
        return _('بانتظار النموذج', 'Awaiting form');
      case 'FORM_RECEIVED':
        return _('تم استلام النموذج', 'Form received');
      case 'CONTRACT_CREATION':
        return _('إعداد العقد', 'Contract');
      case 'AWAITING_CONTRACT_APPROVAL':
        return _('بانتظار الاعتماد', 'Awaiting approval');
      case 'EXPIRED':
        return _('منتهي', 'Expired');
      case 'PENDING':
        return _('قيد التنفيذ', 'Pending');
      case 'ON_HOLD':
        return _('معلّق', 'On hold');
      case 'DONE':
        return _('مكتمل', 'Done');
      case 'TRAINING':
        return _('تدريب', 'Training');
      case 'REQUEST_SENT':
        return _('تم الإرسال', 'Request sent');
      case 'DRAFT':
        return _('مسودة', 'Draft');
      case 'SENT':
        return _('مُرسل', 'Sent');
      case 'PENDING_EMPLOYEE_APPROVAL':
        return _('بانتظار الموظف', 'Awaiting employee');
      case 'REQUESTED':
        return _('مطلوب', 'Requested');
      case 'IN_PROGRESS':
        return _('قيد الإجراء', 'In progress');
      case 'ASSETS_PENDING':
        return _('بانتظار العهد', 'Assets pending');
      case 'NOTICE_SENT':
        return _('تم الإشعار', 'Notice sent');
      case 'SETTLEMENT':
        return _('المخالصة', 'Settlement');
      default:
        return key;
    }
  }

  /// Hold reasons come from a fixed enum; anything else shows verbatim.
  String holdReason(String key) {
    switch (key) {
      case 'ID_MISMATCH':
        return _('عدم تطابق رقم الهوية', 'ID mismatch');
      case 'DOB_MISMATCH':
        return _('عدم تطابق تاريخ الميلاد', 'Date of birth mismatch');
      case 'GOVERNMENT_EMPLOYEE':
        return _('موظف حكومي', 'Government employee');
      case 'OPTIONAL_SUBSCRIPTION':
        return _('اشتراك اختياري', 'Optional subscription');
      case 'INCOMPLETE_DATA':
        return _('بيانات غير مكتملة', 'Incomplete data');
      case 'AWAITING_INSURER':
        return _('بانتظار شركة التأمين', 'Awaiting insurer');
      case 'OTHER':
        return _('أخرى', 'Other');
      default:
        return key;
    }
  }

  // ── directory
  String get searchHint =>
      _('ابحث بالاسم أو الرقم الوظيفي', 'Search name or employee no.');
  String get filterOnboarding => _('قيد التوظيف', 'Onboarding');
  String get filterActive => _('على رأس العمل', 'Active');
  String get filterInactive => _('منتهي الخدمة', 'Inactive');
  String get noResults => _('لا توجد نتائج', 'No results');
  String get noResultsHint =>
      _('جرّب اسمًا آخر أو غيّر التصفية.', 'Try another name or change the filter.');

  // ── employee file
  String get employeeFile => _('ملف الموظف', 'Employee file');
  String get stageTwoProcesses => _('الإجراءات', 'Stage-2 processes');
  String doneOf(int done, int total) =>
      isAr ? 'اكتمل $done من $total' : '$done of $total done';
  String get employment => _('بيانات التوظيف', 'Employment');
  String get jobTitle => _('المسمى الوظيفي', 'Job title');
  String get employmentType => _('نوع التعاقد', 'Type');
  String get hireDate => _('تاريخ التعيين', 'Hire date');
  String get project => _('المشروع', 'Project');
  String get phone => _('الجوال', 'Phone');
  String get actions => _('الإجراءات', 'Actions');
  String get moreActions => _('إجراءات أخرى', 'More');
  String get actionDone => _('تم تنفيذ الإجراء', 'Done');
  String get holdTitle => _('تعليق الإجراء', 'Put on hold');
  String get reason => _('السبب', 'Reason');
  String get noteOptional => _('ملاحظة (اختياري)', 'Note (optional)');
  String get confirmHold => _('تعليق', 'Put on hold');

  String processName(String key) {
    switch (key) {
      case 'gosi':
        return _('التأمينات الاجتماعية', 'GOSI');
      case 'medical':
        return _('التأمين الطبي', 'Medical insurance');
      case 'criminal':
        return _('خلو السوابق', 'Criminal record');
      default:
        return key;
    }
  }

  String employmentTypeLabel(String key) {
    switch (key) {
      case 'FULL_TIME':
        return _('دوام كامل', 'Full time');
      case 'PART_TIME':
        return _('دوام جزئي', 'Part time');
      case 'TEMPORARY':
        return _('مؤقت', 'Temporary');
      default:
        return key;
    }
  }

  /// Transition verbs. Unknown actions render their raw name rather than
  /// disappearing — a new machine edge must never produce a blank button.
  String action(String key) {
    switch (key) {
      case 'SEND_FORM':
        return _('إرسال النموذج', 'Send form');
      case 'REQUEST_MISSING':
        return _('طلب المستندات الناقصة', 'Request missing');
      case 'ACCEPT_DOCUMENTS':
        return _('اعتماد المستندات', 'Accept documents');
      case 'SEND_CONTRACT':
        return _('إرسال العقد', 'Send contract');
      case 'REOPEN':
        return _('إعادة الفتح', 'Reopen');
      case 'COMPLETE':
        return _('إتمام', 'Complete');
      case 'HOLD':
        return _('تعليق', 'Hold');
      case 'RESUME':
        return _('استئناف', 'Resume');
      case 'CANCEL':
        return _('إلغاء', 'Cancel');
      case 'SEND_REQUEST':
        return _('إرسال الطلب', 'Send request');
      case 'RECEIVE':
        return _('استلام', 'Receive');
      default:
        return key;
    }
  }

  // ── inbox
  String unreadCount(int n) =>
      n == 0 ? _('لا جديد', 'Nothing new') : (isAr ? '$n غير مقروء' : '$n unread');
  String get markAllRead => _('تعليم الكل كمقروء', 'Mark all read');
  String get inboxEmpty => _('لا توجد إشعارات', 'No notifications');
  String get inboxEmptyHint =>
      _('ستظهر هنا التنبيهات والتذكيرات.', 'Alerts and reminders will appear here.');

  /// Coarse on purpose: an exact timestamp is noise in a notification list.
  String relativeTime(DateTime at) {
    final diff = DateTime.now().difference(at);
    if (diff.inMinutes < 1) return _('الآن', 'Just now');
    if (diff.inMinutes < 60) {
      return isAr ? 'منذ ${diff.inMinutes} د' : '${diff.inMinutes}m ago';
    }
    if (diff.inHours < 24) {
      return isAr ? 'منذ ${diff.inHours} س' : '${diff.inHours}h ago';
    }
    if (diff.inDays == 1) return _('أمس', 'Yesterday');
    if (diff.inDays < 7) {
      return isAr ? 'منذ ${diff.inDays} أيام' : '${diff.inDays}d ago';
    }
    return at.toIso8601String().substring(0, 10);
  }

  // ── home dashboard
  String dateLine(DateTime d) {
    const weekdaysAr = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const weekdaysEn = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final w = (isAr ? weekdaysAr : weekdaysEn)[d.weekday - 1];
    final m = (isAr ? monthsAr : monthsEn)[d.month - 1];
    return isAr ? '$w، ${d.day} $m' : '$w, ${d.day} $m';
  }

  String get pipelineTitle => _('مسار التوظيف', 'Onboarding pipeline');
  String nActive(int n) => isAr ? '$n قيد الإجراء' : '$n active';
  String get pipelineEmpty =>
      _('لا توجد سجلات في مسار التوظيف حاليًا.', 'Nothing is in the pipeline right now.');
  String get expiryTitle => _('وثائق قاربت على الانتهاء', 'Expiring documents');
  String get expiryExpired => _('منتهية', 'Expired');
  String expiryWithin(int days) => isAr ? 'خلال $days يومًا' : '≤ $days days';
  String get recentActivity => _('آخر النشاطات', 'Recent activity');
  String get noActivity => _('لا نشاط بعد.', 'No activity yet.');

  /// Audit verbs for the activity feed; raw key when a new one appears.
  String auditAction(String key) {
    switch (key) {
      case 'CREATE':
        return _('تم الإنشاء', 'created');
      case 'ACTIVATED':
        return _('تم التفعيل', 'activated');
      case 'EXPIRE':
        return _('انتهت المهلة', 'expired');
      case 'SLA_REMINDER':
        return _('تذكير آلي', 'reminder sent');
      case 'SLA_ESCALATION':
        return _('تصعيد آلي', 'escalated');
      case 'LINK_SENT':
        return _('تم إرسال الرابط', 'link sent');
      case 'UPDATE_PROFILE':
        return _('تحديث البيانات', 'profile updated');
      case 'DOCUMENT_ADDED':
        return _('إضافة وثيقة', 'document added');
      case 'DOCUMENT_RENEWED':
        return _('تجديد وثيقة', 'document renewed');
      default:
        return key;
    }
  }

  // ── more / privacy
  String get privacyAccountTitle => _('حسابك', 'Your account');
  String get privacyAccountBody => _(
      'الحسابات في هذا التطبيق تُدار من قِبل جهة العمل. لا يوجد تسجيل ذاتي، ويقتصر الوصول على موظفي الموارد البشرية والأدوار المخوّلة.',
      'Accounts in this app are managed by the employer. There is no self-registration; access is limited to HR staff and authorised roles.');
  String get privacyDataTitle => _('بياناتك', 'Your data');
  String get privacyDataBody => _(
      'يعرض التطبيق بيانات نظام الموارد البشرية المخزّنة على خادم الشركة، ولا يخزّن نسخًا منها على الجهاز باستثناء رمز الدخول في المخزن الآمن.',
      'The app shows HR records stored on the company server. Nothing is kept on the device except the sign-in token, held in secure storage.');
  String get privacyDeleteTitle => _('حذف البيانات', 'Data deletion');
  String get privacyDeleteBody => _(
      'لطلب حذف بياناتك أو حسابك، تواصل مع إدارة الموارد البشرية — الحسابات تُدار من قِبل جهة العمل.',
      'To request deletion of your data or account, contact the HR department — accounts are employer-managed.');
  String get privacyPolicyTitle => _('سياسة الخصوصية', 'Privacy policy');

  // ── shared
  String get retry => _('إعادة المحاولة', 'Retry');
  String get offline =>
      _('لا يوجد اتصال بالخادم', 'Cannot reach the server');
  String get somethingWrong => _('حدث خطأ ما', 'Something went wrong');
  String get privacy => _('الخصوصية والبيانات', 'Privacy & data');
  String get language => _('English', 'العربية');
}

/// Delegate so `Localizations.localeOf` and directionality behave normally.
class SDelegate extends LocalizationsDelegate<S> {
  const SDelegate();

  @override
  bool isSupported(Locale locale) =>
      S.supported.any((l) => l.languageCode == locale.languageCode);

  @override
  Future<S> load(Locale locale) async => S(locale);

  @override
  bool shouldReload(SDelegate old) => false;
}
