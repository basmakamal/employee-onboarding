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
