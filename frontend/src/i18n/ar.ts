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
    // Shared across every CRUD screen, so the platform says the same thing in
    // the same place everywhere (constitution §2.2).
    save: 'حفظ',
    cancel: 'إلغاء',
    confirm: 'تأكيد',
    edit: 'تعديل',
    delete: 'حذف',
    actions: 'إجراءات',
    search: 'بحث',
    searchPlaceholder: 'ابحث…',
    notSet: 'غير محدَّد',
    required: 'هذا الحقل مطلوب.',
    saved: 'تم الحفظ.',
    created: 'تمت الإضافة.',
    deleted: 'تم الحذف.',
    saveFailed: 'تعذّر الحفظ.',
    loadFailed: 'تعذّر تحميل البيانات.',
    loading: 'جارٍ التحميل…',
    deleteFailed: 'تعذّر الحذف.',
    // TD-15: a stale version means someone else edited the row. Reloading is
    // the only correct response — never a silent overwrite.
    conflict: 'عدّل مستخدم آخر هذا السجل أثناء عملك. تم تحديث البيانات — يرجى المراجعة وإعادة المحاولة.',
    reasonHint: 'يُسجَّل هذا التبرير في سجل المراجعة (10 أحرف على الأقل).',
    reasonTooLong: 'التبرير طويل جداً ({max} حرف كحد أقصى).',
    choose: 'اختر…',
    all: 'الكل',
    yes: 'نعم',
    no: 'لا',
    saving: 'جارٍ الإرسال…',
    pagination: 'تصفّح النتائج',
    previous: 'السابق',
    next: 'التالي',
    pageOf: 'صفحة {page} من {pages}',
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
    kindSession: 'حصة',
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
  // §5.5 / §4.1 — the unified registration form. The applicant chooses a
  // Branch and nothing else organisational (Revision 39).
  register: {
    title: 'طلب الانضمام',
    lede: 'املأ البيانات التالية. سيراجع مشرف الجمعية طلبك قبل تفعيل الحساب.',
    kindLabel: 'نوع التسجيل',
    kindAdult: 'تسجيل شخصي (الكبار)',
    kindParentChild: 'تسجيل ولي أمر مع ابن/ابنة',
    kindHint: 'اختر «ولي أمر» إذا كنت تسجّل ابناً أو ابنة إلى جانب حسابك.',
    you: 'بياناتك',
    parent: 'بيانات ولي الأمر',
    child: 'بيانات الابن/الابنة',
    // Revision 40 — matching how Moroccan administrative records read.
    firstNameArabic: 'الاسم الشخصي',
    lastNameArabic: 'الاسم العائلي',
    // Revision 41 — split like the Arabic pair. Optional, but as a pair.
    firstNameFrench: 'الاسم الشخصي بالفرنسية (اختياري)',
    lastNameFrench: 'الاسم العائلي بالفرنسية (اختياري)',
    errFrenchPair: 'يرجى إدخال الاسمين معاً بالفرنسية، أو تركهما فارغين.',
    nickname: 'الكنية (اختياري)',
    nicknameHint: 'تُستعمل داخلياً للبحث فقط.',
    phone: 'رقم الهاتف (اختياري)',
    phoneHint: 'أرقام وعلامة + والمسافات فقط.',
    notes: 'ملاحظات (اختياري)',
    sex: 'الجنس',
    sexFemale: 'أنثى',
    sexMale: 'ذكر',
    // Revision 39 — the one organisational choice the applicant makes.
    branchLegend: 'المقر',
    branchLabel: 'المقر المطلوب',
    branchEmpty: 'اختر المقر…',
    branchHint: 'المقر الذي ترغب في الالتحاق به. يحدّد المشرف الحلقة بعد الموافقة.',
    consentLegend: 'الموافقات',
    // Split so the statute can be a real button inside the sentence, opening
    // the explanation. A checkbox that names a law and explains nothing is one
    // people tick without understanding — the opposite of informed consent.
    consentDataProcessingPrefix: 'أوافق على معالجة بياناتي الشخصية وفق',
    consentLawName: 'القانون 09-08',
    consentDataProcessingSuffix: '.',
    lawTitle: 'حماية بياناتك الشخصية — القانون 09-08',
    lawIntro:
      'القانون 09-08 هو القانون المغربي المتعلق بحماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي. هذا ملخّص بلغة مبسّطة لما نجمعه ولماذا.',
    lawWhyTitle: 'لماذا نجمع هذه البيانات؟',
    lawWhyBody:
      'لتسجيلك في الحلقات ومتابعة تقدّمك الدراسي، وللتواصل معك بخصوص المواعيد والأنشطة. دون هذه البيانات لا يمكن للجمعية أن تفتح لك حساباً أو أن تسجّلك في حلقة.',
    lawWhatTitle: 'ما الذي نحتفظ به؟',
    lawWhat1: 'اسمك ورقم هاتفك وبريدك الإلكتروني.',
    lawWhat2: 'المقر الذي اخترته، والحلقة التي تُسنَد إليك بعد الموافقة.',
    lawWhat3: 'متابعة الحفظ والنتائج الخاصة بك.',
    lawWhat4: 'قرارك بشأن الموافقات، وتاريخ تسجيله.',
    lawWhoTitle: 'من يمكنه الاطّلاع عليها؟',
    lawWhoBody:
      'المؤطِّرات والمسؤولات في الجمعية، كلٌّ في حدود عملها فقط: المؤطِّرة ترى طالبات حلقتها، والمسؤولة ترى فرعها. لا تُنشر بياناتك ولا تُباع ولا تُشارَك مع أي جهة خارجية.',
    lawUseTitle: 'هل تُستعمل لغرض آخر؟',
    lawUseBody:
      'لا. تُستعمل حصراً لتدبير شؤون الجمعية التعليمية. لا نستعملها للإشهار ولا نرسل بها رسائل تجارية.',
    lawRightsTitle: 'ما هي حقوقك؟',
    lawRightsBody: 'يمنحك القانون 09-08 حقوقاً يمكنك ممارستها في أي وقت:',
    lawRight1: 'الاطّلاع على بياناتك المحفوظة لدينا.',
    lawRight2: 'تصحيح أي معلومة خاطئة أو غير محدَّثة.',
    lawRight3: 'الاعتراض على المعالجة أو طلب حذف بياناتك، في الحدود التي يسمح بها القانون.',
    lawContact:
      'لممارسة أيٍّ من هذه الحقوق، يكفي التواصل مع إدارة الجمعية في أحد مقراتها.',
    consentMedia: 'الموافقة على نشر الصوت/التسجيلات',
    consentMediaChoose: 'اختر قراراً…',
    consentMediaHint: 'قرارك مسجَّل في الحالتين — «لا» جواب صحيح ويُحفظ كما هو.',
    submit: 'إرسال الطلب',
    submittedTitle: 'تم استلام طلبك',
    submittedBody: 'طلبك في انتظار موافقة المشرف. سنعلمك عند اتخاذ القرار.',
    // A submitted applicant has an account in `Pending`; signing in shows the
    // status screen (§2.1) rather than nothing, so the link is worth offering.
    submittedNext: 'يمكنك متابعة حالة طلبك بتسجيل الدخول بنفس حساب Google.',
    noTokenTitle: 'لم تكتمل عملية تسجيل الدخول',
    noTokenBody: 'يبدأ التسجيل بالدخول عبر Google. يرجى البدء من جديد.',
    startOver: 'المتابعة عبر Google',
    errRequired: 'هذا الحقل مطلوب.',
    // Marked from the server's own verdict — it named this field, so the
    // applicant is told which one rather than "review the fields".
    errServerField: 'راجع هذا الحقل — لم يقبله الخادم.',
    errTooLong: 'النص طويل جداً.',
    errPhone: 'رقم غير صالح — أرقام وعلامة + والمسافات فقط.',
    errBranch: 'يرجى اختيار المقر.',
    errConsent: 'لا يمكن إنشاء الحساب دون الموافقة على معالجة البيانات.',
    errMediaDecision: 'يرجى اختيار قرار بشأن نشر الصوت.',
    // The token is single-use and short-lived: "try again" would be wrong
    // advice, because retrying the FORM cannot help.
    tokenSpent: 'انتهت صلاحية جلسة التسجيل. يرجى البدء من جديد عبر Google.',
    rejected: 'تعذّر قبول البيانات. يرجى مراجعة الحقول والمحاولة من جديد.',
    failed: 'تعذّر إرسال الطلب حالياً. يرجى المحاولة بعد قليل.',
    // A configuration gap, not an outage — waiting cannot fix it, so the
    // message says what is missing and who can set it (§2.3 owner task).
    consentVersionMissing:
      'لا يمكن استقبال الطلبات بعد: لم تُسجَّل نسخة نص الموافقة القانوني (legal.consent_text_version). يرجى إبلاغ إدارة الجمعية لضبطها من إعدادات المنصة.',
  },
  teacher: {
    schedules: {
      lede: 'الجداول التي تؤطّرينها. لعرض المستفيدات اضغطي على الجدول.',
      caption: 'حصصي',
      empty: 'لا توجد جداول مسندة إليك حالياً.',
    },
    nav: {
      label: 'أقسام التدريس',
      dashboard: 'مساحة التدريس',
      schedules: 'حصصي',
      content: 'المحتوى التعليمي',
      exams: 'الامتحانات',
    },
    // Each names WHAT is missing. The schedules entry names a specification gap
    // rather than unbuilt UI, because that is the honest reason.
    blocked: {
      dashboard: 'تُبنى واجهات مساحة التدريس بعد اكتمال شاشات الحصص.',
      content: 'يتطلب هذا القسم واجهات رفع المحتوى (المرحلة السادسة)، وهي غير متوفرة بعد.',
      exams: 'يتطلب هذا القسم واجهات بناء الامتحانات وتصحيحها (المرحلة الخامسة)، وهي غير متوفرة بعد.',
    },
  },
  session: {
    notFound: 'لا توجد حصة بهذا العنوان.',
    backToCalendar: 'العودة إلى الجدول',
    cancelled: 'حصة ملغاة',
    date: 'التاريخ',
    time: 'التوقيت',
    audience: 'الفئة المعنية',
    level: 'المستوى',
    branch: 'الفرع',
    room: 'القاعة',
    staff: 'الأطر',
    notes: 'ملاحظات',
    recordings: 'التسجيلات',
    materials: 'المواد المرفقة',
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
      schedules: 'جداول الحصص',
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
      groups: 'يتطلب هذا القسم واجهات إدارة الحلقات وجداولها الأسبوعية، وهي غير متوفرة بعد.',
      users: 'يتطلب هذا القسم واجهات إدارة المستخدمين والأدوار والنطاقات، وهي غير متوفرة بعد.',
      calendar: 'يتطلب هذا القسم واجهات إدارة الأنشطة والمناسبات، وهي غير متوفرة بعد.',
      content: 'يتطلب هذا القسم واجهات رفع المحتوى وعرضه (المرحلة السادسة)، وهي غير متوفرة بعد.',
    },
    // الفئات والمواد — المفردتان اللتان يقوم عليهما النموذج التعليمي كله.
    taxonomy: {
      lede: 'الفئات تجمع المستويات، والمواد هي ما تُدرَّس فيها. القراءة متاحة للمسؤولات، والتعديل للمديرة العامة وحدها.',
      categoriesTitle: 'الفئات',
      categoriesLede:
        'مراحل تعليمية عامة: طفل، يافع، بالغ. لا تُذكر في اسم الفئة أي إشارة إلى الجنس — ذلك يُحدَّد في المستوى نفسه.',
      subjectsTitle: 'المواد',
      subjectsLede: 'المواد المتاحة للإسناد إلى المستويات. المادة غير المسندة لا تُدرَّس في أي مستوى.',
      colName: 'الاسم',
      colLevels: 'المستويات',
      colOrder: 'الترتيب',
      orderHint: 'اتركيه فارغًا للترتيب الأبجدي.',
      categoryNameHint: 'مرحلة تعليمية عامة (طفل، يافع، بالغ) — دون أي إشارة إلى الجنس.',
      createCategory: 'إضافة فئة',
      editCategory: 'تعديل الفئة',
      createSubject: 'إضافة مادة',
      editSubject: 'تعديل المادة',
      deleteCategoryTitle: 'حذف الفئة',
      deleteCategoryBody: 'سيتم حذف الفئة «{name}». لا يمكن الحذف ما دامت تضم مستويات.',
      deleteSubjectTitle: 'حذف المادة',
      deleteSubjectBody: 'سيتم حذف المادة «{name}». لا يمكن الحذف ما دامت مسندة إلى مستوى.',
      categoryBlocked: 'تعذّر الحذف: الفئة ما زالت تضم مستويات. احذفي المستويات أولًا.',
      subjectBlocked:
        'تعذّر الحذف: المادة ما زالت مسندة إلى مستوى أو مرتبطة بأفواج أو جداول أو محتوى.',
    },
    levels: {
      lede: 'المستويات داخل كل فئة. إنشاء مستوى يُنشئ معه «المجموعة 1» في الفرع الذي تختارينه.',
      caption: 'المستويات',
      create: 'إضافة مستوى',
      editTitle: 'تعديل المستوى',
      colName: 'الاسم',
      colCategory: 'الفئة',
      colGender: 'الفئة المستهدفة',
      colGroups: 'المجموعات',
      colSubjects: 'المواد',
      colStudents: 'الطالبات المسجلات',
      colOrder: 'الترتيب',
      allCategories: 'كل الفئات',
      orderHint: 'الترتيب داخل الفئة. اتركيه فارغًا للترتيب الأبجدي.',
      gender: {
        any: 'الجميع',
        girls_only: 'الإناث فقط',
        boys_only: 'الذكور فقط',
      },
      genderHint: 'يحدَّد هنا لا في الاسم، حتى يتمكن النظام من التحقق منه عند التسجيل.',
      firstGroupBranch: 'فرع «المجموعة 1»',
      firstGroupHint:
        'الفرع لا يُحفظ في المستوى؛ هو مكان المجموعة الأولى التي تُنشأ معه، إذ لا يمكن تسجيل أحد في مستوى بلا مجموعة.',
      branchRequired: 'اختاري فرعًا للمجموعة الأولى.',
      categoryFixedHint: 'لا يمكن نقل المستوى إلى فئة أخرى بعد إنشائه.',
      manageSubjects: 'المواد',
      createdWithGroup: 'تم إنشاء المستوى، ومعه «{group}» في فرع {branch}.',
      deleted: 'تم حذف المستوى ومجموعاته الفارغة.',
      deleteTitle: 'حذف المستوى',
      deleteBody: 'سيتم حذف المستوى «{name}» ومجموعاته الفارغة معه.',
      deleteBodyEnrolled:
        'المستوى «{name}» يضم {n} طالبة مسجلة، ولا يمكن حذفه قبل نقلهن إلى مستوى آخر.',
      deleteBlocked:
        'تعذّر الحذف: ما زالت هناك تسجيلات أو أفواج أو جداول أو امتحانات أو محتوى مرتبط بهذا المستوى.',
    },
    levelSubjects: {
      title: 'مواد المستوى',
      lede: 'المواد التي تُدرَّس في مستوى «{level}». المادة غير المسندة هنا لا يمكن إنشاء فوج أو جدول لها.',
      backToLevels: 'العودة إلى المستويات',
      addLabel: 'إسناد مادة',
      add: 'إسناد',
      addHint: 'المادة المسندة تُدرَّس لكل المستوى ما لم تُقسَّم إلى أفواج.',
      noneLeft: 'كل المواد المتاحة مسندة إلى هذا المستوى.',
      assigned: 'تم إسناد المادة إلى المستوى.',
      alreadyAssigned: 'المادة مسندة أصلًا إلى هذا المستوى.',
      empty: 'لا تُدرَّس في هذا المستوى أي مادة بعد. أسندي مادة قبل إنشاء الأفواج أو الجداول.',
      organise: 'تنظيم المادة',
      remove: 'إزالة',
      removed: 'تمت إزالة المادة من المستوى.',
      removeTitle: 'إزالة المادة',
      removeBody: 'سيتم إلغاء تدريس مادة «{name}» في هذا المستوى.',
      removeBlocked:
        'تعذّرت الإزالة: توجد أفواج تقسّم هذه المادة في هذا المستوى. احذفي الأفواج أولًا.',
    },
    groups: {
      lede: 'المجموعات الإدارية داخل كل مستوى. المجموعة تنظيمية فقط: لا قاعة ولا أستاذ ولا سعة.',
      caption: 'المجموعات الإدارية',
      create: 'إضافة مجموعة',
      editTitle: 'تعديل المجموعة',
      colName: 'الاسم',
      colLevel: 'المستوى',
      colBranch: 'الفرع',
      colOrder: 'الترتيب',
      // States the consequence: these are re-creations, not edits.
      fixedAfterCreate: 'المستوى والفرع يُحدَّدان عند الإنشاء ولا يُعدَّلان — النقل إعادة إنشاء.',
      roster: 'المستفيدات',
      rosterTitle: 'مستفيدات المجموعة',
      rosterEmpty: 'لا توجد مستفيدات في هذه المجموعة.',
      findStudent: 'البحث عن مستفيدة',
      enrol: 'تسجيل',
      unenrol: 'إخراج',
      alreadyInLevel: 'المستفيدة مسجّلة في مجموعة أخرى داخل نفس المستوى. النقل يتم بإخراجها أولاً.',
      deleteTitle: 'حذف المجموعة',
      deleteBody: 'لا يمكن حذف مجموعة تضم مستفيدات، أو يستهدفها جدول حصص، أو كانت الوحيدة في مستواها.',
      // Each refusal names its own cause — "فشل الحفظ" would hide which.
      refused_ENROLMENTS_EXIST: 'لا يمكن الحذف: المجموعة تضم مستفيدات مسجّلات.',
      refused_SCHEDULES_EXIST: 'لا يمكن الحذف: يستهدف هذه المجموعة جدول حصص.',
      refused_LAST_GROUP_IN_LEVEL: 'لا يمكن الحذف: لا يجوز أن يبقى المستوى دون أي مجموعة.',
    },
    subjectOrg: {
      title: 'تنظيم المادة',
      lede: 'أفواج المادة داخل مستوى {level}. الفوج يُنشأ فقط عند الحاجة لتقسيم المستوى.',
      create: 'إضافة فوج',
      editTitle: 'تعديل الفوج',
      pickSubject: 'اختر مادة لعرض تنظيمها.',
      // A different claim from "everyone is placed": the question does not apply.
      notSplit: 'هذه المادة تُدرَّس للمستوى كاملاً — لا يوجد تقسيم، ولا مستفيدات بلا فوج.',
      unassignedTitle: 'مستفيدات بلا فوج',
      unassignedLede: 'مسجّلات في المستوى وبلا فوج في هذه المادة — أي أنهن بلا حصص فيها.',
      allPlaced: 'كل المستفيدات موزّعات على الأفواج.',
      placeIn: 'إسناد إلى فوج…',
      groupsTitle: 'الأفواج',
      members: '{n} مستفيدة',
      deleteTitle: 'حذف الفوج',
      deleteBody: 'ستعود مستفيدات الفوج إلى قائمة «بلا فوج».',
      deleted: 'حُذف الفوج. عادت {n} مستفيدة إلى قائمة «بلا فوج».',
      refusedSchedules: 'لا يمكن الحذف: يستهدف هذا الفوج جدول حصص.',
      alreadySplit: 'المستفيدة في فوج آخر من نفس المادة. الإسناد يتم بإخراجها أولاً.',
      notEnrolled: 'المستفيدة غير مسجّلة في هذا المستوى — التسجيل يسبق الإسناد.',
      notInLevel: 'هذه المادة غير مسندة إلى هذا المستوى.',
    },
    schedules: {
      lede: 'جداول الحصص المتكرّرة: المادة، نمط التدريس وهدفه، الفرع والقاعة، الأوقات والتكرار.',
      caption: 'جداول الحصص',
      subject: 'المادة',
      mode: 'نمط التدريس',
      branch: 'الفرع',
      room: 'القاعة',
      time: 'التوقيت',
      recurrence: 'التكرار',
      staff: 'الأطر',
      noRoom: 'بلا قاعة',
      mode_entire_level: 'المستوى كامل',
      mode_administrative_group: 'مجموعة إدارية',
      mode_teaching_group: 'فوج مادة',
      create: 'إضافة جدول',
      editTitle: 'تعديل الجدول',
      target: 'الهدف',
      year: 'السنة الدراسية',
      start: 'من (سا:د)',
      end: 'إلى (سا:د)',
      weekdays: 'أيام الأسبوع',
      teacher: 'الأستاذ(ة)',
      fixedAfterCreate:
        'المادة ونمط التدريس وهدفه والفرع والسنة تُحدَّد عند الإنشاء ولا تُعدَّل — تغييرها يعيد توجيه حصص مُولّدة سابقاً.',
      clash: 'القاعة أو أحد المؤطرين مرتبط بحصة أخرى في نفس الوقت. اختر توقيتاً أو قاعة أخرى.',
      writeTitle: 'أثر الحفظ على الحصص',
      writeSummary: 'حصص مُنشأة: {created} — حصص محدَّثة: {resynced}.',
      protectedLede: 'حصص لم تُمَس لأنها تحمل عملاً فعلياً:',
      recurrence_weekly: 'أسبوعي',
      recurrence_multiple_weekdays: 'عدة أيام في الأسبوع',
      recurrence_biweekly_alternating: 'كل أسبوعين',
      recurrence_none: 'مرة واحدة',
      day_monday: 'الاثنين',
      day_tuesday: 'الثلاثاء',
      day_wednesday: 'الأربعاء',
      day_thursday: 'الخميس',
      day_friday: 'الجمعة',
      day_saturday: 'السبت',
      day_sunday: 'الأحد',
      viewConflicts: 'عرض التعارضات',
      viewRoster: 'عرض المستفيدات',
      remove: 'حذف الجدول',
      conflictsTitle: 'التعارضات',
      // Says what was compared, because "no conflicts" from a rule comparison
      // and from a real session comparison are not the same assurance.
      conflictsEmpty: 'لا توجد تعارضات في الحصص المُولّدة.',
      conflictsLede: 'محسوبة على الحصص المُولّدة فعلياً، لا على قواعد التكرار.',
      conflictKind_room: 'القاعة',
      conflictKind_teacher: 'الأستاذ(ة)',
      conflictKind_assistant: 'المساعد(ة)',
      rosterTitle: 'المستفيدات',
      // The property that matters: it is recomputed, not stored.
      rosterLede: 'محسوبة الآن من نمط التدريس وهدفه — ليست لائحة محفوظة.',
      rosterEmpty: 'لا توجد مستفيدات في هذا الجدول حالياً.',
      deleteTitle: 'حذف جدول الحصص',
      deleteBody: 'ستُحذف الحصص المستقبلية غير المحمية. الحصص التي تحمل عملاً فعلياً تبقى.',
      deleted: 'حُذف الجدول. حصص محذوفة: {removed} — حصص محفوظة: {retained}.',
    },
    dashboard: {
      title: 'لوحة التحكم',
      lede: 'أقسام الإدارة المتاحة لحسابك.',
    },
    branches: {
      lede: 'مقرات الجمعية وقاعاتها. البيانات المرجعية يحرّرها المشرف العام فقط.',
      create: 'إضافة مقر',
      editTitle: 'تعديل المقر',
      tableCaption: 'قائمة مقرات الجمعية',
      searchPlaceholder: 'ابحث بالاسم أو العنوان أو الهاتف…',
      colName: 'اسم المقر',
      colAddress: 'العنوان',
      colStart: 'تاريخ بدء العمل',
      colOrder: 'ترتيب العرض',
      phone: 'الهاتف',
      email: 'البريد الإلكتروني',
      openingHours: 'أوقات العمل',
      mapsUrl: 'رابط الخريطة',
      addressHint: '5 أحرف على الأقل. يظهر هذا العنوان للزوار في الصفحة الرئيسية.',
      // §7: free text, displayed verbatim and NEVER parsed — the hint says so,
      // because the next reader will otherwise expect a weekday grid.
      openingHoursHint: 'نص حر بعدة أسطر، يُعرض كما هو ولا يُحلَّل. عدّله عند رمضان أو الأسابيع الاستثنائية.',
      mapsUrlHint: 'رابط كامل يبدأ بـ https://',
      urlHttps: 'يجب أن يبدأ الرابط بـ https://',
      addressShort: 'العنوان قصير جداً (5 أحرف على الأقل).',
      startHint: 'قبل هذا التاريخ لا تظهر أنشطة المقر في الجدول.',
      orderHint: 'رقم اختياري يحدّد ترتيب الظهور. الأصغر أولاً.',
      deleteTitle: 'حذف المقر',
      deleteBody: 'سيتم حذف «{name}». يمكن استرجاعه خلال 90 يوماً.',
      // TD-5: deletion is prohibited while rooms or groups reference the branch.
      deleteBlocked: 'لا يمكن حذف هذا المقر لأن قاعات أو حلقات ما زالت مرتبطة به.',
    },
    // §5.6 / §14.2 — طلبات الانضمام. The queue is deliberately unscoped by
    // branch (Revision 29), so the lede says who it covers rather than implying
    // a scope the data does not carry.
    approvals: {
      lede: 'طلبات التسجيل الجديدة وطلبات ربط الأبناء، في انتظار القرار.',
      tableCaption: 'طلبات الانضمام في انتظار القرار',
      colApplicants: 'المعنيّون بالطلب',
      colType: 'نوع الطلب',
      colBundle: 'ما سيتغيّر عند الموافقة',
      // Revision 39 — what the applicant ASKED FOR, not where they are placed.
      colBranch: 'المقر المطلوب',
      branchNone: 'غير مذكور',
      filterBranch: 'المقر',
      filterAllBranches: 'كل المقرات',
      colSubmitted: 'تاريخ الإرسال',
      filterType: 'نوع الطلب',
      filterAll: 'كل الأنواع',
      typeRegistration: 'تسجيل جديد',
      typeLink: 'ربط ابن',
      role: {
        applicant: 'مقدّم الطلب',
        child: 'الابن/الابنة',
        parent: 'ولي الأمر',
      },
      // Stated in records, not adjectives: an administrator approving a bundle
      // is approving people, and needs to know how many.
      bundleChildren: '{n} ابن/ابنة',
      bundleLinks: '{n} رابط أسري',
      bundleJoin: ' و',
      bundleSolo: 'مقدّم الطلب وحده',
      approve: 'موافقة',
      reject: 'رفض',
      approveTitle: 'الموافقة على الطلب',
      approveBody: 'سيتم تفعيل الحسابات التالية دفعة واحدة: {names}.',
      rejectTitle: 'رفض الطلب',
      rejectBody: 'سيتم رفض طلب: {names}.',
      // §5.6: a rejection requires a reason; the server refuses without one and
      // TD-8 writes it to the audit log.
      reasonLabel: 'سبب الرفض',
      reasonHint: 'يُسجَّل السبب في سجل المراجعة (500 حرف كحد أقصى).',
      approved: 'تمت الموافقة — تم تفعيل {n} سجل.',
      rejected: 'تم الرفض — تم تحديث {n} سجل.',
      alreadyDecided: 'تم البتّ في هذا الطلب من قِبل مشرف آخر. حُدِّثت القائمة.',
      decisionFailed: 'تعذّر تنفيذ القرار. يرجى المحاولة من جديد.',
    },
    // §5.6 / Revision 42 — Platform Settings, first iteration.
    settings: {
      lede: 'إعدادات المنصة. يحرّرها المشرف العام وحده، ويُسجَّل كل تغيير في سجل المراجعة.',
      consentVersionLabel: 'نسخة نص الموافقة القانوني',
      // States the consequence, because an administrator editing this needs to
      // know that stored consents keep the version they were given under.
      consentVersionHint:
        'المعرّف المسجَّل مع كل موافقة جديدة (مثال: 2026-08-v1). تغييره يسري على التسجيلات اللاحقة فقط — الموافقات المحفوظة تحتفظ بالنسخة التي وُقّعت عليها. لا يمكن استقبال أي طلب تسجيل قبل ضبط هذه القيمة.',
      notConfigured: 'غير مضبوط — التسجيل متوقف',
      current: 'القيمة الحالية: {value}',
      saved: 'تم حفظ الإعداد وتسجيله في سجل المراجعة.',
      errEmpty: 'لا يمكن ترك القيمة فارغة.',
      errRejected: 'لم يقبل الخادم هذه القيمة. يرجى مراجعتها.',
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
    // §14.4 — a path the sitemap does not define. Never a blank page.
    notFoundTitle: 'الصفحة غير موجودة',
    notFoundBody: 'لا يوجد شيء على هذا العنوان. ربما تغيّر الرابط أو كُتب خطأً.',
    // Distinct from "not found": the section EXISTS in the sitemap, it is not
    // built yet — and saying which is more useful than saying neither.
    pendingScreenTitle: 'هذا القسم قيد الإعداد',
    pendingScreenBody: 'لم تُبنَ واجهة هذا القسم بعد. ستكون متاحة في مرحلة لاحقة.',
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
