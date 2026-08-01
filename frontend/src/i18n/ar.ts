/**
 * Arabic catalogue (SRS §6, §16.2).
 *
 * **Every user-facing string flows through a key — hardcoded UI text is
 * prohibited** (§16.2). Only the `ar` catalogue ships in MVP; the `fr`/`en`
 * catalogues are a post-launch content task (§10.1), which is why the keys
 * exist now even though there is one language.
 */
export const ar = {
  app: {
    name: 'بذور الأمل',
    tagline: 'جمعية بذور الأمل — مراكش',
    logoAlt: 'شعار جمعية بذور الأمل',
  },
  nav: {
    home: 'الرئيسية',
    calendar: 'الجدول الزمني',
    resources: 'المحتوى التعليمي',
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب',
    logout: 'تسجيل الخروج',
    dashboard: 'لوحة التحكم',
    primaryLabel: 'التنقل الرئيسي',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
    skipToContent: 'تخطَّ إلى المحتوى',
    account: 'الحساب',
  },
  roles: {
    switcherLabel: 'الدور الحالي',
    switcherHint: 'اختر الدور الذي تعمل به',
    super_admin: 'مشرف عام',
    admin: 'مسؤولة',
    teacher: 'مؤطِّرة',
    parent: 'ولي الأمر',
    student: 'طالبة',
  },
  child: {
    switcherLabel: 'الطفل الحالي',
    switcherHint: 'اختر الطفل الذي تتابع بياناته',
    none: 'لا يوجد أطفال مرتبطون',
    fallbackName: 'طفل مرتبط',
  },
  landing: {
    heroTitle: 'نزرع بذرة العلم، ونرعاها حتى تُثمر',
    heroLede:
      'منصة تعليمية تجمع البرامج والدروس والمتابعة التربوية في مكان واحد، وتفتح أبوابها للكبار واليافعين والأطفال بمراكش.',
    ctaLogin: 'تسجيل الدخول',

    missionEyebrow: 'رسالتنا',
    missionTitle: 'تعليمٌ متاح، ومتابعةٌ لا تنقطع',
    missionLede:
      'نؤمن أن لكل واحدة نصيباً من العلم مهما كان سنّها أو ظرفها. لذلك نفتح حلقاتنا للكبار قبل الصغار، ونتابع تقدّم كل طالبة متابعةً فرديةً موثّقة، لا مجرّد حضورٍ في سجل.',

    stagesEyebrow: 'مسالك التعليم',
    stagesTitle: 'ثلاثة أطوار تعليمية',
    stagesLede:
      'ينقسم العمل التربوي إلى ثلاثة أطوار، لكل طور مستوياته الخاصة وحلقاته وأوقاته الأسبوعية.',
    stageAdultTitle: 'الكبار',
    stageAdultBody:
      'حلقات تحفيظ ومراجعة للقرآن الكريم، ودروس في العلوم الشرعية، إلى جانب فصول محو الأمية لمن لم تتح لها فرصة التعلّم في صغرها.',
    stageAdultMeta: 'يشمل مستوى محو الأمية ومستويات التحفيظ',
    stageTeenTitle: 'اليافعون',
    stageTeenBody:
      'برنامج يوازن بين حفظ القرآن الكريم وفهم معانيه، مع دروس تُراعي مرحلة المراهقة وانشغالات الدراسة النظامية.',
    stageTeenMeta: 'مستويات متدرّجة حسب الحفظ',
    stageChildTitle: 'الطفل',
    stageChildBody:
      'تأسيس مبكّر في القراءة والحفظ بأسلوب محبَّب، تحت إشراف مؤطِّرات وبمتابعة أولياء الأمور عبر حساباتهم.',
    stageChildMeta: 'يتابع ولي الأمر تقدّم طفله',

    howEyebrow: 'كيف تنضمّين',
    howTitle: 'ثلاث خطوات حتى بداية الحلقة',
    howLede: 'لا يحتاج التسجيل إلى زيارة مسبقة؛ يمكن إتمام الطلب كاملاً من الهاتف.',
    step1Title: 'الدخول بحساب Google',
    step1Body: 'تسجيل الدخول يتم عبر حساب Google وحده، دون كلمات سر تُحفظ أو تُنسى.',
    step2Title: 'استكمال بيانات التسجيل',
    step2Body:
      'تُملأ استمارة واحدة للمتعلّمة، أو لولي الأمر وطفله معاً، مع الموافقات المطلوبة صراحةً.',
    step3Title: 'مراجعة الطلب وتفعيله',
    step3Body:
      'تراجع مشرفة الجمعية الطلب، وبعد الموافقة يُفتح الحساب ويُسنَد إلى الفرع والحلقة المناسبين.',



    footerRights: 'جميع الحقوق محفوظة لجمعية بذور الأمل',
  },
  common: {
    close: 'إغلاق',
  },
  calendar: {
    title: 'الجدول الزمني',
    lede: 'مواعيد الحلقات الأسبوعية والأنشطة والمناسبات في مقرات الجمعية.',
    branchLabel: 'الفرع',
    allBranches: 'كل الفروع',
    categoryLabel: 'الفئة',
    allCategories: 'كل الفئات',
    levelLabel: 'المستوى',
    allLevels: 'كل المستويات',
    monthLabel: 'الشهر',
    today: 'اليوم',
    // Short visible labels; the long forms below are the accessible names.
    // Each long name CONTAINS its short label, which keeps voice control working
    // (WCAG 2.5.3 Label in Name) — a user saying "السابق" still matches.
    navPrevious: 'السابق',
    navNext: 'التالي',
    navLabel: 'تنقّل بين الأشهر',
    filtersLabel: 'تصفية الجدول',
    previousMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    dayDialogTitle: 'أنشطة اليوم',
    selectedDayEmpty: 'لا توجد أنشطة في هذا اليوم.',
    gridLabel: 'شبكة الشهر',
    loading: 'جارٍ تحميل الجدول…',
    error: 'تعذّر تحميل الجدول حالياً.',
    monthEmpty: 'لا توجد أنشطة مسجّلة في هذا الشهر.',
    allDay: 'طوال اليوم',
    eventCount: 'عدد الأنشطة',
    kindGroup: 'حلقة',
    kindEvent: 'نشاط',
    hijriUnavailable: 'لم يُسجَّل التاريخ الهجري لهذا الشهر بعد.',
    detailsTitle: 'تفاصيل النشاط',
    detailsDate: 'التاريخ',
    detailsTime: 'التوقيت',
    detailsKind: 'النوع',
    detailsBranch: 'الفرع',
    detailsRoom: 'القاعة',
    detailsCategory: 'الفئة',
    detailsLevel: 'المستوى',
    detailsRecurrence: 'التكرار',
    detailsResources: 'الموارد المرفقة',
    detailsInstructors: 'المؤطِّرات',
    detailsVisibility: 'مستوى الظهور',
    openDetails: 'عرض التفاصيل',
    visibilityPublic: 'عام',
    visibilityPrivate: 'خاص',
    visibilityHidden: 'مخفي',
    // The recurrence enum (§4.4). `biweekly_alternating` is named for what it
    // means — a week on, a week off — rather than transliterated, because it is
    // the pattern the SRS singles out as needing explicit modelling.
    recurrence: {
      none: 'لا يتكرر',
      daily: 'يومي',
      weekly: 'أسبوعي',
      biweekly_alternating: 'أسبوع بأسبوع (بالتناوب)',
      yearly: 'سنوي',
    },
    months: [
      'يناير',
      'فبراير',
      'مارس',
      'أبريل',
      'ماي',
      'يونيو',
      'يوليوز',
      'غشت',
      'شتنبر',
      'أكتوبر',
      'نونبر',
      'دجنبر',
    ],
    // BR-17: the week starts Monday, everywhere.
    weekdaysShort: ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
  },
  branches: {
    eyebrow: 'أين تجدنا',
    title: 'فروعنا ومعلومات التواصل',
    lede: 'تُقام الحلقات في مقرات الجمعية بمراكش. يمكنكم زيارتنا أو التواصل معنا خلال أوقات العمل.',
    viewOnMap: 'عرض الموقع على الخريطة',
    mapUnavailable: 'لم يُسجَّل موقع هذا المقر على الخريطة بعد.',
    empty: 'لم تُسجَّل أي مقرات بعد.',
    error: 'تعذّر تحميل معلومات المقرات حالياً.',
    footerCity: 'مراكش، المغرب',
  },
  auth: {
    // §4.1: one screen serves rejected, suspended and soft-deleted accounts
    // (Revision 16) — deliberately one message and one key.
    deactivatedTitle: 'الحساب غير مُفعّل',
    deactivatedBody: 'الحساب غير مُفعّل — يرجى التواصل مع إدارة الفرع.',
    // §2.1: a dedicated, prominently styled full-page status screen.
    pendingTitle: 'حسابك في انتظار الموافقة',
    pendingBody:
      'تم استلام طلبك بنجاح. سيقوم مشرف الجمعية بمراجعته، ولا يمكن الوصول إلى بيانات المنصة قبل الموافقة.',
    // §4.1b step 7 — the four callback failure keys.
    errorUserDenied: 'تم إلغاء تسجيل الدخول. يمكنك المحاولة مرة أخرى.',
    errorStateMismatch: 'انتهت صلاحية الجلسة أثناء تسجيل الدخول. يرجى المحاولة من جديد.',
    errorOauthUnavailable: 'خدمة تسجيل الدخول غير متاحة حالياً. يرجى المحاولة بعد قليل.',
    errorEmailUnverified: 'لم يتم التحقق من بريدك الإلكتروني عند Google.',
    errorAccountDeactivated: 'الحساب غير مُفعّل — يرجى التواصل مع إدارة الفرع.',
    retry: 'إعادة المحاولة',
  },
  admin: {
    soon: 'قريباً',
    soonLong: 'قيد الإعداد — لم تُبنَ واجهات هذا القسم بعد.',
    pendingTitle: 'هذا القسم قيد الإعداد.',
    notFound: 'صفحة غير موجودة',
    notFoundBody: 'لا يوجد قسم بهذا العنوان.',
    nav: {
      label: 'أقسام الإدارة',
      dashboard: 'لوحة التحكم',
      groups: 'الحلقات',
      levels: 'المستويات',
      taxonomy: 'الفئات والمواد',
      users: 'المستخدمون',
      approvals: 'طلبات الانضمام',
      calendar: 'الجدول والأنشطة',
      content: 'مكتبة المحتوى',
      branches: 'الفروع والقاعات',
      hijri: 'التقويم الهجري',
      settings: 'إعدادات المنصة',
    },
    // §14.1's groups, rendered in its order.
    section: {
      academic: 'الشؤون التعليمية',
      people: 'الأشخاص',
      calendar: 'الجدول',
      content: 'المحتوى',
      administration: 'الإدارة',
    },
    // Each names WHAT is missing — "coming soon" tells nobody whether the wait
    // is a day or a milestone.
    blocked: {
      levels: 'يتطلب هذا القسم واجهات برمجية لإدارة المستويات، وهي غير متوفرة بعد.',
      taxonomy: 'يتطلب هذا القسم واجهات برمجية لإدارة الفئات والمواد، وهي غير متوفرة بعد.',
      content: 'يتطلب هذا القسم واجهات رفع المحتوى وعرضه (المرحلة السادسة)، وهي غير متوفرة بعد.',
      settings: 'يتطلب هذا القسم واجهات برمجية لإعدادات المنصة، وهي غير متوفرة بعد.',
    },
    dashboard: {
      title: 'لوحة التحكم',
      lede: 'أقسام الإدارة المتاحة لحسابك.',
    },
    hijri: {
      title: 'التقويم الهجري',
      // Revision 32: the vocabulary is binding. RECORD the Ministry's official
      // announcement — never choose, define or set it.
      lede: 'تسجيل بدايات الأشهر الهجرية كما أعلنتها وزارة الأوقاف والشؤون الإسلامية.',
      yearLabel: 'السنة الهجرية',
      yearHint: 'من 1300 إلى 1600.',
      tableCaption: 'أشهر السنة الهجرية وتواريخ بدايتها الميلادية',
      colMonth: 'الشهر',
      colStart: 'تاريخ البداية الميلادي',
      colStatus: 'الحالة',
      record: 'تسجيل',
      recorded: 'تم تسجيل بداية الشهر.',
      publish: 'نشر أشهر السنة',
      published: 'تم نشر الأشهر',
      publishFailed: 'تعذّر النشر — قد لا توجد أشهر في وضع المسودة.',
      conflict: 'عدّل مشرف آخر هذا الشهر أثناء عملك. تم تحديث البيانات — يرجى المراجعة وإعادة التسجيل.',
      notRecorded: 'لم يُسجَّل',
      statusDraft: 'مسودة',
      statusPublished: 'منشور',
      draftWarning: 'توجد أشهر في وضع المسودة لا تظهر في المنصة حتى تُنشر.',
      tailBadge: 'آخر شهر مسجَّل',
      // The boundary that explains a half-labelled month on the public calendar.
      tailWarning:
        'الشهر الأخير المسجَّل يظهر 29 يوماً فقط حتى يُسجَّل الشهر الذي يليه — فمعرفة بداية الشهر لا تحدد نهايته.',
    },
  },
  states: {
    // §14.4 — every page implements all of these. Forgetting empty states is
    // named there as the most common failure mode.
    loading: 'جارٍ التحميل…',
    empty: 'لا توجد عناصر بعد.',
    error: 'حدث خطأ أثناء تحميل البيانات.',
    noResults: 'لا توجد نتائج مطابقة للتصفية.',
    clearFilters: 'إزالة التصفية',
    noPermission: 'ليست لديك صلاحية لعرض هذه الصفحة.',
    offlineRetry: 'تعذّر الاتصال. إعادة المحاولة؟',
    requestId: 'رقم الطلب',
    notBuiltTitle: 'هذه الصفحة قيد الإنجاز',
    notBuiltBody: 'نعمل حالياً على إعداد هذا القسم، وسيكون متاحاً قريباً بإذن الله.',
  },
  content: {
    // The /content-unavailable page (§3.1) — a stale public link to content
    // whose visibility changed.
    unavailableTitle: 'تغيّرت صلاحية الوصول إلى هذا المحتوى',
    unavailableBody:
      'تغيّرت صلاحية الوصول إلى هذا المحتوى — يرجى تسجيل الدخول أو التواصل مع إدارة الفرع.',

    // The educational library (§5.2, §4.9).

    title: 'المحتوى التعليمي',
    lede: 'اختر المستوى الدراسي للوصول إلى المحتوى.',
    backToLibrary: 'كل المستويات',
    globalScope: 'بدون فرع',
    currentYear: 'السنة الحالية',
    openItem: 'عرض المحتوى',
    download: 'تنزيل الملف',
    // Presentation classes, not file extensions (§14.6): the label tells a reader
    // what will happen when they open the item.
    kind: {
      pdf: 'ملف PDF',
      video: 'فيديو',
      audio: 'تسجيل صوتي',
      image: 'صورة',
      document: 'مستند',
    },
    // Binary units as Arabic words, so a size does not force a direction
    // override inside RTL text.
    sizeUnits: ['بايت', 'كيلوبايت', 'ميغابايت', 'غيغابايت'],
    countItems: { one: 'مادة', two: 'مادتان', many: 'مواد' },
    countYears: { one: 'سنة دراسية', two: 'سنتان دراسيتان', many: 'سنوات دراسية' },
    filtersLabel: 'تصفية المحتوى',
    searchLabel: 'البحث',
    searchPlaceholder: 'ابحث في العناوين…',
    yearLabel: 'السنة الدراسية',
    allYears: 'كل السنوات',
    branchLabel: 'الفرع',
    allBranches: 'كل الفروع',
    typeLabel: 'النوع',
    allTypes: 'كل الأنواع',
    previewTitle: 'معاينة المحتوى',
    previewError: 'تعذّر تحميل المعاينة.',
    // Deliberately distinct from an error: nothing is wrong, the file simply
    // cannot be served yet.
    previewUnavailable: 'المعاينة غير متاحة بعد لهذا الملف.',
    previewDownloadOnly: 'هذا النوع من الملفات يُنزَّل ولا يُعرض داخل المنصة.',
    previewUnsupported: 'متصفحك لا يدعم تشغيل هذا الملف — يمكنك تنزيله.',
  },
} as const;

export type Catalog = typeof ar;
