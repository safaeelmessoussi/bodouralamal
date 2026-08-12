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
    // R60 — reached only by a DEEP LINK into a portal the active role does not
    // own (a bookmark, a shared URL). `لوحة التحكم` and the menus now follow the
    // active role, so nothing inside the application navigates here.
    wrongRoleTitle: 'هذه الصفحة تخصّ دورًا آخر',
    wrongRoleBody: 'صفحة «{module}» ليست ضمن صلاحيات دوركِ الحالي «{active}».',
    wrongRoleNoRole: 'لا تملكين دورًا يفتح هذه الصفحة.',
    wrongRoleSwitch: 'التبديل إلى {role}',
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
    // R64 — a PAGE (§14.1), not an item in the account switcher: a switcher
    // lists the contexts you may work in, and registering is a task.
    register: '＋ تسجيل طفل',
    registerTitle: 'تسجيل ابن/ابنة',
    registerLede:
      'يُملأ هذا النموذج بنفس المعطيات المطلوبة في طلب الانضمام. يصل الطلب إلى الإدارة لمراجعته.',
    registerSubmit: 'إرسال الطلب',
    registerSubmittedTitle: 'وصل طلبك',
    registerSubmitted:
      'وصل الطلب إلى الإدارة لمراجعته. لا يمنحك إرساله أي صلاحية على بيانات الطفل؛ يظهر الطفل في قائمة التبديل بعد الموافقة.',
    registerFailed: 'تعذّر إرسال الطلب. يرجى المحاولة من جديد.',
    backToProfile: 'العودة إلى صفحة الحساب',
  },
  // §5.2 (R65) — the personal section: role-independent, for every account.
  profile: {
    title: 'حسابي',
    lede: 'بياناتك الشخصية وطلباتك. هذه الصفحة تخصّ شخصك، لا الدور الذي تعملين به.',
    detailsTitle: 'بياناتي',
    nameFrench: 'الاسم بالفرنسية',
    identityReadOnly:
      'الاسم والبريد الإلكتروني وحالة الحساب تُعدَّل من طرف الإدارة، لأنها تخصّ الهوية لا وسائل الاتصال.',
    saved: 'تمّ حفظ التعديل.',
    saveFailed: 'تعذّر الحفظ. يرجى المحاولة من جديد.',
    versionConflict: 'عُدِّلت هذه البيانات من مكان آخر. أعيدي تحميل الصفحة ثم حاولي مجدداً.',
    childrenTitle: 'تسجيل الأبناء',
    childrenLede:
      'يمكن لأي حساب أن يطلب تسجيل ابن أو ابنة، مهما كان دوره. صفة «ولي الأمر» تخصّ متابعة الأبناء بعد الموافقة.',
    childStatus: {
      pending: 'قيد المراجعة',
      approved: 'مقبول',
      rejected: 'مرفوض',
    },
  },
  // §5.3 (R62.10) — one screen, two contexts: the caller's own record, or the
  // child they are acting for. The banner names which.
  studentDashboard: {
    title: 'لوحة الطالبة',
    viewingChild: 'تتابعين بيانات: {name}',
    chooseChild: 'اختاري الطفل الذي تتابعين بياناته من قائمة التبديل في الأعلى.',
    noChildren: 'لا يوجد أطفال معتمدون بعد.',
    registerChild: '＋ تسجيل ابن/ابنة',
    referenceCode: 'الرمز المرجعي',
    category: 'الفئة',
    level: 'المستوى',
    branch: 'المقر',
    notPlaced: 'لم يتم بعد إسناد فئة ومستوى. تتولى الإدارة ذلك بعد الموافقة.',
    moreEnrollments: 'وهناك {count} تسجيل آخر في مستوى مختلف.',
    upcoming: 'حصص اليوم والقادمة',
  },
  landing: {
    // **The association's own words, not a written-for-the-web paraphrase.**
    // The title IS its motto («شعار الجمعية») and the lede states its stated
    // fields of work and its aim, so the public face of the platform says what
    // the association says about itself rather than a marketing echo of it.
    heroTitle: 'من أجل أم رائدة و طفل واعد',
    heroLede:
      'منصة تعليمية تجمع البرامج والدروس والمتابعة التربوية في مجالات العلم و الثقافة و المجتمع و تهدف الى تعزيز التنمية المستدامة و التقدم الأجتماعي، وتفتح أبوابها للكبار واليافعين والأطفال.',
    ctaLogin: 'تسجيل الدخول',

    // **Kept though the section is removed** (Owner instruction): its substance
    // moved into the hero lede, and an unused key costs nothing while a deleted
    // one has to be rewritten if the section returns.
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
    // R66 — the native date control renders its own placeholder in the
    // BROWSER's locale, which we cannot change; the field states the order it
    // expects instead, and echoes the chosen date in Arabic underneath.
    dateFormatHint: 'التاريخ بصيغة: يوم/شهر/سنة',
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
    kindExam: 'امتحان',
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
    kindAdult: 'أُسجّل نفسي',
    kindParentChild: 'أُسجّل ابناً/ابنة إلى جانب حسابي',
    kindTeacher: 'أرغب في الالتحاق بهيئة التأطير',
    categoryLabel: 'الفئة',
    categoryEmpty: 'اختاري الفئة…',
    categoryHint: 'المرحلة التعليمية المطلوبة للطالب/ة. تُقترح منها المستويات عند الموافقة، والقرار النهائي للإدارة.',
    errCategory: 'اختاري الفئة.',
    // يُقال صراحةً: الطلب لا يمنح شيئًا، والصفة تُسنَد بعد الموافقة.
    teacherNotice:
      'سيصل طلبك إلى الإدارة لمراجعته. لا يمنحك إرسال الطلب أي صلاحية؛ تُسنَد صفة الأستاذة عند الموافقة.',
    kindHint: 'هذا السؤال عن **مَن** يُسجَّل، لا عن المرحلة التعليمية؛ تُحدَّد الفئة في الأسفل.',
    you: 'بياناتك',
    parent: 'بيانات ولي الأمر',
    child: 'بيانات الابن/الابنة',
    // R62.1 — one request may carry several children, decided one at a time.
    childAdd: '＋ إضافة ابن/ابنة',
    childRemove: 'حذف هذا الابن/الابنة',
    // R62.7 — informs the placement decision; it never decides it. The hint
    // says so, because a parent who believes this chooses the Category will
    // answer strategically rather than truthfully.
    schoolingStage: 'المستوى الدراسي الحالي (اختياري)',
    schoolingStageChoose: 'اختر المستوى…',
    schoolingStageHint: 'يساعد الإدارة على اقتراح الفئة المناسبة، ولا يحدّدها تلقائياً.',
    schoolingStage_pre_primary: 'التعليم الأوّلي',
    schoolingStage_primary: 'الابتدائي',
    schoolingStage_middle: 'الإعدادي',
    schoolingStage_high: 'الثانوي',
    schoolingStage_post_secondary: 'ما بعد الثانوي',
    schoolingStage_not_in_school: 'غير متمدرس',
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
    // إدارة مواد الحصة (§4.9, TD-3.12). الإزالة تفكّ الارتباط ولا تحذف الملف.
    materialsAction: 'المواد',
    materialsTitle: 'مواد الحصة',
    materialsNone: 'لا توجد مواد مرفقة بهذه الحصة.',
    materialsLink: 'إرفاق',
    materialsLinkExisting: 'إرفاق مادة موجودة',
    materialsChooseItem: 'اختاري مادة…',
    materialsUploadNew: 'رفع ملف جديد',
    materialsRemove: 'إزالة من الحصة',
    materialsFailed: 'تعذّر تنفيذ العملية. يرجى إعادة المحاولة.',
  },
  // المفردات المشتركة لكل ما يُجدول — الأنشطة والحصص معًا (§4.4).
  // وجودها في مكان واحد هو ما يجعل الشاشتين تبدوان متطابقتين فعلًا.
  scheduling: {
    lede: 'كل ما يظهر في التقويم: الحصص والأنشطة. اختاري نوع العنصر ثم أكملي حقوله.',
    create: 'إضافة عنصر',
    editTitle: 'تعديل العنصر',
    allTypes: 'كل الأنواع',
    viewLabel: 'طريقة العرض',
    view: { list: 'قائمة', calendar: 'تقويم' },
    deleteTitle: 'حذف العنصر',
    deleteBody: 'سيتم حذف «{title}». الحصص المستقبلية غير المحمية تُحذف معه؛ ما يحمل عملاً فعلياً يبقى.',
    // الحد مذكور لا مخفي: دمج مصدرين مرقّمين لا ينتج صفحة صحيحة دون قراءتهما.
    truncated: 'المعروض هو أول 100 عنصر من كل نوع. صفّي حسب النوع لتصفّح قائمة أطول.',
    // بدل زرّ معطّل بلا تفسير: تُذكر أول خانة ناقصة بترتيب النموذج نفسه.
    invalid: {
      startDate: 'اختاري تاريخ البداية.',
      branch: 'اختاري الفرع.',
      level: 'اختاري المستوى.',
      target: 'اختاري الحلقة المعنية.',
      subject: 'اختاري المادة.',
      year: 'اختاري السنة الدراسية.',
      times: 'أدخلي وقت البداية والنهاية.',
      weekdays: 'اختاري يوماً واحداً على الأقل لهذا النمط من التكرار.',
      title: 'أدخلي عنوان العنصر.',
      room: 'اختاري القاعة.',
      supervisor: 'اختاري المؤطرة المسؤولة عن الامتحان.',
    },
    // عنوان فارغ حالة واردة — يُذكر بالعربية ولا يُترك فراغاً ولا قيمة داخلية.
    untitled: 'بدون عنوان',
    // امتحان حضوري (§4.6، مراجعة 58). النمط «عن بُعد» يُعرض ولا يُختار.
    exam: {
      mode: 'نوع الامتحان',
      physical: 'حضوري',
      online: 'عن بُعد',
      soon: 'قريباً',
      onlineSoon: 'الامتحانات عن بُعد — قريباً. هذه الميزة قيد التخطيط ولم تُبنَ بعد.',
      chooseBranchFirst: 'اختاري الفرع أولاً',
      // الطاقم هنا يراقب ولا يدرّس — مفردات مختلفة لأن الدور مختلف.
      supervisor: 'الأستاذ/المؤطر المسؤول',
      assistants: 'المؤطرون المساعدون',
      assistantsHint: 'اختياري. يمكن اختيار أكثر من مؤطرة للمراقبة.',
      // الحلقة اختيارية: تركها فارغة يعني أن المستوى كله يجتاز الامتحان معاً.
      wholeLevel: 'المستوى كله',
    },
    // مفردات الجدولة الموحّدة (R56): نوع العنصر ثم الحقول المشتركة ثم حقول النوع.
    itemType: 'نوع العنصر',
    typeFixed: 'النوع يُحدَّد عند الإنشاء — تغييره يعني نقل السجل إلى جدول آخر.',
    typeSoon: 'قريباً',
    type: {
      class: 'حصة',
      activity: 'نشاط',
      exam: 'امتحان',
    },
    title: 'العنوان',
    description: 'الوصف',
    allDay: 'يوم كامل (بدون توقيت)',
    endDate: 'تاريخ النهاية',
    endDateHint: 'اتركيه فارغاً لعنصر ليوم واحد.',
    // ثمانية أنماط، تُترجَم إلى قيم RecurrenceType في مكان واحد.
    pattern: {
      once: 'مرة واحدة',
      daily: 'يومياً',
      weekly: 'أسبوعياً',
      weekly_days: 'أسبوعياً (أيام محددة)',
      biweekly: 'كل أسبوعين',
      biweekly_days: 'كل أسبوعين (أيام محددة)',
      monthly: 'شهرياً',
      yearly: 'سنوياً',
    },
    recurrence: 'التكرار',
    startDate: 'تاريخ البداية',
    startDateHint: 'أول تاريخ تبدأ منه الحصص.',
    // بدون مرجع لا معنى لـ«الأسبوع الأول» في التناوب نصف الشهري (§7).
    startDateAnchorHint: 'يحدّد الأسبوع الذي يبدأ به التناوب، لا تاريخ البداية فقط.',
    recurrenceEnd: 'نهاية التكرار',
    recurrenceEndHint: 'آخر تاريخ يتكرر فيه. اتركيه فارغًا لتكرار مفتوح.',
    weekdays: 'أيام الأسبوع',
    weekdaysHint: 'الحصة تقع في هذه الأيام — هذه هي القاعدة نفسها لا خيارًا إضافيًا.',
    weekday: {
      monday: 'الاثنين',
      tuesday: 'الثلاثاء',
      wednesday: 'الأربعاء',
      thursday: 'الخميس',
      friday: 'الجمعة',
      saturday: 'السبت',
      sunday: 'الأحد',
    },
    startTime: 'من الساعة',
    endTime: 'إلى الساعة',
    timeHint: 'بصيغة 24 ساعة، مثل 15:30.',
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
      // **Administrative Groups, not حلقات.** §20 rule 22 forbids conflating
      // organisation with delivery, and this label did exactly that: a حلقة is
      // a Teaching Group — a Subject's circle inside a Level — while this node
      // manages the administrative division OF a Level.
      groups: 'مجموعات المستويات',
      // R69 — each of the two subject screens gets its own node; they were
      // reachable only through row actions borrowed by unrelated screens.
      levelSubjects: 'مواد المستوى',
      teachingGroups: 'حلقات المواد',
      scheduling: 'الجدولة',
      levels: 'المستويات',
      categories: 'الفئات',
      subjects: 'المواد',
      users: 'المستخدمون',
      approvals: 'طلبات الانضمام',
      calendar: 'الأنشطة',
      content: 'مكتبة المحتوى',
      branches: 'الفروع والقاعات',
      trash: 'سلة المحذوفات',
      hijri: 'التقويم الهجري',
      settings: 'إعدادات المنصة',
    },
    // §14.1's groups, rendered in its order.
    section: {
      academic: 'الشؤون التعليمية',
      people: 'الأشخاص',
      // R51 — واحدة تجمع الأنشطة والحصص: كلاهما ما يُجدول.
      scheduling: 'الجدولة',
      content: 'المحتوى',
      administration: 'الإدارة',
    },
    // Each names WHAT is missing — "coming soon" tells nobody whether the wait
    // is a day or a milestone.
    blocked: {
      groups: 'يتطلب هذا القسم واجهات إدارة مجموعات المستويات وجداولها الأسبوعية، وهي غير متوفرة بعد.',
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
        'تعذّر الحذف: المادة ما زالت مسندة إلى مستوى أو مرتبطة بحلقات أو جداول أو محتوى.',
    },
    calendar: {
      lede: 'الأنشطة والمناسبات: العطل والحفلات والامتحانات. الأنشطة لا تُنشئ حصصًا — جداول الحصص شاشة أخرى.',
      caption: 'الأنشطة والمناسبات',
      create: 'إضافة نشاط',
      editTitle: 'تعديل النشاط',
      colTitle: 'العنوان',
      colVisibility: 'مستوى الظهور',
      colRecurrence: 'التكرار',
      colScope: 'النطاق',
      colFirst: 'أول تاريخ',
      colOccurrences: 'عدد المرات',
      description: 'الوصف',
      from: 'من',
      to: 'إلى',
      // النافذة الزمنية ليست زينة: نقطة النهاية محدودة بالتواريخ، فما يُعرض يتبعها.
      windowNote: 'تُعرض الأنشطة الواقعة داخل النافذة الزمنية أعلاه، ويُحسب عدد المرات داخلها.',
      startDate: 'تاريخ البداية',
      endDate: 'تاريخ النهاية',
      endDateHint: 'اتركيه فارغًا لنشاط ليوم واحد.',
      startTime: 'من الساعة',
      endTime: 'إلى الساعة',
      timeHint: 'بصيغة 24 ساعة، مثل 15:30. اتركيه فارغًا لنشاط يستغرق اليوم كله.',
      recurrenceEnd: 'نهاية التكرار',
      recurrenceEndHint: 'آخر تاريخ يتكرر فيه النشاط.',
      visibilityHint: 'عام: يراه الزوار. خاص: للمسجلات. مخفي: للطاقم فقط.',
      scopeGlobal: 'كل الفروع',
      scopeBranch: 'فرع',
      scopeLabel: 'النطاق',
      scopeTargetLabel: 'الجهة المعنية',
      // النطاق يُحدَّد عند الإنشاء: إعادة توجيهه لاحقاً تغيّر — بصمت — من كان يرى النشاط.
      scopeFixed: 'النطاق يُحدَّد عند الإنشاء ولا يُعدَّل.',
      scopeCategory: 'فئة',
      scopeLevel: 'مستوى',
      scopeHint: 'يُحدَّد عند الإنشاء فقط.',
      scopeLocked: 'لا يمكن تغيير نطاق النشاط بعد إنشائه — تغيير الجمهور إعادة إنشاء لا تعديل.',
      deleted: 'تم حذف النشاط.',
      deleteTitle: 'حذف النشاط',
      deleteBody: 'سيتم حذف نشاط «{title}» وكل مواعيده من الجدول.',
    },
    // §4.4 (المراجعة 50): كل عملية قد تمسّ سلسلة متكررة تسأل عن نطاقها أولًا.
    sessions: {
      title: 'حصص الجدول',
      lede: 'مواعيد هذا الجدول. أي تعديل يسأل أولًا: هذه الحصة وحدها، أم هي وما بعدها، أم كل الحصص.',
      caption: 'الحصص',
      backToSchedules: 'العودة إلى الجداول',
      colDate: 'التاريخ',
      colTime: 'التوقيت',
      colStatus: 'الحالة',
      colProtection: 'محمية من التعديل',
      notProtected: 'قابلة للتعديل',
      status: {
        scheduled: 'مبرمجة',
        held: 'أُنجزت',
        cancelled: 'ملغاة',
      },
      // الرموز جزء من العقد: إعادة تسميتها تغيّر سجل المسؤولة لسبب استثناء الحصة.
      protection: {
        OVERRIDDEN: 'عُدِّلت يدويًا',
        LIFECYCLE: 'أُنجزت أو أُلغيت',
        HAS_CONTENT: 'مرتبط بها محتوى',
        HAS_ATTENDANCE: 'سُجِّل فيها الحضور',
      },
      editTitle: 'تعديل الحصة',
      scopeLegend: 'ما الذي يشمله التعديل؟',
      scope: {
        this_session: 'هذه الحصة وحدها',
        this_and_future: 'هذه الحصة وكل ما بعدها',
        all_sessions: 'كل حصص هذا الجدول',
      },
      scopeHint: {
        this_session: 'حصة {date} فقط. تُعلَّم كمعدَّلة يدويًا فلا يمسّها أي تعديل لاحق على الجدول.',
        this_and_future: 'يُقسَّم الجدول عند {date}: ما قبله يبقى كما هو، وما بعده يتبع القيم الجديدة.',
        all_sessions: 'الجدول نفسه ({total} حصة معروضة). الحصص المعدَّلة يدويًا تبقى على حالها.',
      },
      willChange: {
        this_session: 'سيتغيّر: حصة {date} وحدها.',
        this_and_future: 'سيتغيّر: حصة {date} وكل ما يليها. ما قبلها لا يُمسّ.',
        all_sessions: 'سيتغيّر: كل حصص هذا الجدول عدا المحمية منها.',
      },
      dateOnlyThisSession: 'نقل التاريخ متاح مع «هذه الحصة وحدها» فقط — النطاقان الآخران يعدّلان قاعدة التكرار، وللقاعدة أوقات لا تاريخ.',
      startTime: 'من الساعة',
      endTime: 'إلى الساعة',
      timeHint: 'بصيغة 24 ساعة، مثل 15:30.',
      savedOne: 'تم تعديل هذه الحصة وحدها.',
      savedSplit: 'تم تقسيم الجدول: ما قبل هذا التاريخ بقي كما هو.',
      savedAll: 'تم تعديل الجدول. الحصص المحمية بقيت على حالها.',
      cancel: 'إلغاء الحصة',
      cancelTitle: 'إلغاء حصة {date}',
      cancelBody: 'سبب الإلغاء هو الأثر الوحيد لعدم انعقاد الحصة، ويُسجَّل معه عدد المعنيات بها في حينه.',
      cancelReason: 'سبب الإلغاء',
      cancelReasonHint: 'مطلوب — يُسجَّل في سجل التدقيق.',
      cancelled: 'تم إلغاء الحصة.',
      restore: 'إعادة البرمجة',
      restored: 'أُعيدت برمجة الحصة.',
      pastRestore: 'لا يمكن إعادة برمجة حصة مضى تاريخها.',
      alreadyHeld: 'لا يمكن تعديل حصة أُنجزت.',
    },
    trash: {
      lede: 'السجلات المحذوفة. الاستعادة متاحة للأنواع التي اكتملت آليتها فقط — وما عداها يُذكر سببه صراحةً.',
      caption: 'السجلات المحذوفة',
      colRecord: 'السجل',
      colEntity: 'النوع',
      colDeletedAt: 'تاريخ الحذف',
      colDeletedBy: 'حذفه',
      colPurge: 'الحذف النهائي',
      colRestorable: 'الاستعادة',
      allEntities: 'كل الأنواع',
      from: 'من',
      to: 'إلى',
      searchPlaceholder: 'ابحثي بالاسم أو النوع',
      bySystem: 'النظام',
      canRestore: 'متاحة',
      purge: 'حذف نهائي',
      colPurgeable: 'الحذف النهائي',
      canPurge: 'متاح',
      purgeTitle: 'حذف نهائي لا رجعة فيه',
      purgeBody:
        'سيُحذف «{record}» نهائيًا مع كل ما يتبعه، ولا يمكن التراجع عن هذا الإجراء. هل تؤكدين المتابعة؟',
      purged: 'تم الحذف النهائي.',
      purgeFailed: 'تعذّر الحذف النهائي.',
      dependentsExist: 'لا يمكن الحذف النهائي: ما يزال هناك سجل مرتبط بهذا العنصر.',
      purgeBlocked: {
        ACCOUNTABILITY_RECORD: 'غير متاح — يحفظ سجل المسؤولية',
        CASCADE_CHILDREN: 'غير متاح — يتبعه سجلات أخرى',
        NOT_YET_SUPPORTED: 'غير متاح بعد',
      },
      restore: 'استعادة',
      restored: 'تمت استعادة السجل.',
      restoreTitle: 'استعادة السجل',
      restoreBody: 'سيعود سجل «{record}» إلى مكانه.',
      // §7: الحذف المتسلسل يزيل صفوف العلاقات، واستعادة الصف وحده تُنتج حسابًا
      // يبدو سليمًا وهو معطَّل. لذلك تُذكر الأسباب بدل إخفاء الزر بلا تفسير.
      blocked: {
        CASCADE_RELATIONSHIPS:
          'غير متاحة بعد: الحذف أزال صفوف علاقات (التسجيلات، الأدوار، الروابط العائلية) لم تكتمل آلية إعادتها.',
        CASCADE_CHILDREN:
          'غير متاحة بعد: الحذف أزال سجلات تابعة لم تكتمل آلية إعادتها.',
        NOT_YET_SUPPORTED: 'غير متاحة بعد لهذا النوع.',
      },
      parentDeleted: 'استعيدي السجل الأصل أولًا — لا يمكن إعادة سجل إلى أصل محذوف.',
      alreadyPurged: 'مضت مهلة الاحتفاظ وحُذف السجل نهائيًا، فلا يمكن استعادته.',
      notDeleted: 'هذا السجل غير محذوف أصلًا.',
      restoreFailed: 'تعذّرت الاستعادة.',
      retentionNote:
        'تبقى مهلة التسعين يومًا (BR-15) هي المسار الافتراضي؛ الحذف النهائي إجراء متاح للمشرفة العامة وحدها، ولا يمكن التراجع عنه.',
      entity: {
        Branch: 'فرع',
        Room: 'قاعة',
        Category: 'فئة',
        Subject: 'مادة',
        Level: 'مستوى',
        AdministrativeGroup: 'مجموعة إدارية',
        TeachingGroup: 'حلقة',
        RecurringCourseSchedule: 'جدول حصص',
        Session: 'حصة',
        Event: 'نشاط',
        EducationalContent: 'مادة تعليمية',
        User: 'مستخدم',
      },
    },
    users: {
      lede: 'إدارة الحسابات: البحث والتصفية والإنشاء والتعديل وإسناد الأدوار والنطاقات وإيقاف الحسابات.',
      caption: 'المستخدمون',
      colEmail: 'البريد الإلكتروني',
      colBranches: 'الفروع',
      noEmail: 'لا بريد (حساب بلا دخول)',
      create: 'إضافة حساب',
      created: 'تم إنشاء الحساب. سيُربط عند أول دخول بحساب Google المحدد.',
      editTitle: 'تعديل بيانات المستخدم',
      colName: 'الاسم',
      colNickname: 'الكنية',
      colRoles: 'الأدوار',
      colStatus: 'الحالة',
      colPhone: 'الهاتف',
      searchPlaceholder: 'اسم أو كنية أو هاتف أو بريد',
      searchHint: 'حرفان على الأقل.',
      allRoles: 'كل الأدوار',
      allStatuses: 'كل الحالات',
      allBranches: 'كل الفروع',
      noRole: 'دون دور',
      // حساب بلا دور يستطيع الدخول ولا يصل إلى شيء — تُذكر الحالة لا تُخفى.
      noRoles: 'بلا دور',
      noRolesWarning: 'هذا الحساب بلا أي دور. سيتمكن صاحبه من الدخول دون الوصول إلى أي شيء.',
      role: {
        super_admin: 'مديرة عامة',
        admin: 'مسؤولة',
        teacher: 'أستاذة',
        student: 'طالبة',
        parent: 'ولي أمر',
      },
      status: {
        pending: 'بانتظار الموافقة',
        active: 'نشط',
        suspended: 'موقوف',
        rejected: 'مرفوض',
      },
      email: 'بريد Google',
      emailHint: 'العنوان المخوّل بالمطالبة بهذا الحساب. لا توجد كلمة مرور: يتم الربط عند أول دخول بهذا العنوان.',
      emailInvalid: 'أدخلي عنوان بريد صالحًا.',
      createRoleHint: 'يمكن إسناد الأدوار لاحقًا. إسناد دور «مديرة عامة» يتم من نافذة الأدوار بعد الموافقة على الحساب.',
      branchScope: 'نطاق الفرع',
      branchScopeHint: '«كل الفروع» تعني صلاحية غير مقيدة بفرع، لا غياب الفرع.',
      assignRoles: 'الأدوار',
      rolesTitle: 'أدوار {name}',
      addRole: 'إضافة دور',
      rolesSaved: 'تم حفظ الأدوار.',
      suspend: 'إيقاف الحساب',
      suspendTitle: 'إيقاف حساب {name}',
      // ما تحتاج المسؤولة معرفته قبل التأكيد: الإيقاف ينهي الجلسات فورًا.
      suspendBody: 'سيتم إنهاء كل جلسات هذا الحساب فورًا، ولن يتمكن صاحبه من الدخول حتى إعادة تفعيله.',
      suspendReason: 'سبب الإيقاف',
      suspendReasonHint: 'يُسجَّل في سجل التدقيق، وهو الأثر الوحيد لسبب سحب الوصول.',
      suspended: 'تم إيقاف الحساب وإنهاء جلساته.',
      reactivate: 'إعادة التفعيل',
      reactivateTitle: 'إعادة تفعيل الحساب',
      reactivateBody: 'سيعود حساب «{name}» إلى الحالة النشطة. تبقى الجلسات السابقة منتهية، فيلزم تسجيل الدخول من جديد.',
      reactivated: 'تمت إعادة تفعيل الحساب.',
      lastSuperAdmin: 'تعذّر التنفيذ: هذه آخر مديرة عامة نشطة. عيّني مديرة عامة أخرى أولًا.',
      selfSuspension: 'لا يمكنك إيقاف حسابك الخاص.',
      invalidTransition: 'حالة الحساب لا تسمح بهذا الإجراء.',
      forbidden: 'لا تملكين صلاحية هذا الإجراء. إسناد أدوار الإدارة للمديرة العامة وحدها.',
      notFound: 'هذا المستخدم غير موجود أو خارج نطاقك.',
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
      manageSubjects: 'مواد المستوى',
      // صفر هنا يعني أن المستوى لا يمكن أن يستقبل محتوى ولا جدول حصص — تُذكر
      // الحالة بكلمة لا برقم صامت.
      // The link's accessible name: a bare «0» is not a usable link name, and
      // the action belongs in the name rather than in the cell (WCAG 2.4.4).
      subjectsLinkLabel: 'مواد مستوى «{level}»: {n} — فتح صفحة المواد',
      created: 'تمّ إنشاء المستوى. أنشئي مجموعة له عند الحاجة إلى تقسيمه.',
      createdWithGroup: 'تم إنشاء المستوى، ومعه «{group}» في فرع {branch}.',
      deleted: 'تم حذف المستوى ومجموعاته الفارغة.',
      deleteTitle: 'حذف المستوى',
      deleteBody: 'سيتم حذف المستوى «{name}» ومجموعاته الفارغة معه.',
      deleteBodyEnrolled:
        'المستوى «{name}» يضم {n} طالبة مسجلة، ولا يمكن حذفه قبل نقلهن إلى مستوى آخر.',
      deleteBlocked:
        'تعذّر الحذف: ما زالت هناك تسجيلات أو حلقات أو جداول أو امتحانات أو محتوى مرتبط بهذا المستوى.',
    },
    levelSubjects: {
      title: 'مواد مستوى «{level}»',
      lede: 'المواد التي تُدرَّس في هذا المستوى. المادة غير المسندة هنا لا يمكن إنشاء حلقة أو جدول لها.',
      pickLevel: 'اختاري مستوى لعرض المواد التي تُدرَّس فيه.',
      addLabel: 'إسناد مادة',
      add: 'إسناد',
      addHint: 'المادة المسندة تُدرَّس لكل المستوى ما لم تُقسَّم إلى حلقات.',
      noneLeft: 'كل المواد المتاحة مسندة إلى هذا المستوى.',
      assigned: 'تم إسناد المادة إلى المستوى.',
      alreadyAssigned: 'المادة مسندة أصلًا إلى هذا المستوى.',
      empty: 'لا تُدرَّس في هذا المستوى أي مادة بعد. أسندي مادة قبل إنشاء الحلقات أو الجداول.',
      organise: 'تنظيم المادة',
      remove: 'إزالة',
      removed: 'تمت إزالة المادة من المستوى.',
      removeTitle: 'إزالة المادة',
      removeBody: 'سيتم إلغاء تدريس مادة «{name}» في هذا المستوى.',
      removeBlocked:
        'تعذّرت الإزالة: توجد حلقات تقسّم هذه المادة في هذا المستوى. احذفي الحلقات أولًا.',
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
      title: 'حلقات مادة «{subject}»',
      lede: 'داخل مستوى «{level}». تُنشأ الحلقة فقط عند الحاجة إلى تقسيم المستوى؛ وبدونها تُدرَّس المادة للمستوى كاملاً.',
      create: 'إضافة حلقة',
      editTitle: 'تعديل الحلقة',
      pickLevel: 'اختاري المستوى ثم المادة لعرض حلقاتها.',
      pickSubject: 'اختر مادة لعرض تنظيمها.',
      // A different claim from "everyone is placed": the question does not apply.
      notSplit: 'هذه المادة تُدرَّس للمستوى كاملاً — لا يوجد تقسيم، ولا مستفيدات بلا حلقة.',
      unassignedTitle: 'مستفيدات بلا حلقة',
      unassignedLede: 'مسجّلات في المستوى وبلا حلقة في هذه المادة — أي أنهن بلا حصص فيها.',
      allPlaced: 'كل المستفيدات موزّعات على الحلقات.',
      placeIn: 'إسناد إلى حلقة…',
      groupsTitle: 'الحلقات',
      members: '{n} مستفيدة',
      deleteTitle: 'حذف الحلقة',
      deleteBody: 'ستعود مستفيدات الحلقة إلى قائمة «بلا حلقة».',
      deleted: 'حُذف الحلقة. عادت {n} مستفيدة إلى قائمة «بلا حلقة».',
      refusedSchedules: 'لا يمكن الحذف: يستهدف هذا الحلقة جدول حصص.',
      alreadySplit: 'المستفيدة في حلقة آخر من نفس المادة. الإسناد يتم بإخراجها أولاً.',
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
      mode_teaching_group: 'حلقة مادة',
      create: 'إضافة جدول',
      editTitle: 'تعديل الجدول',
      target: 'الهدف',
      year: 'السنة الدراسية',
      start: 'من (سا:د)',
      end: 'إلى (سا:د)',
      weekdays: 'أيام الأسبوع',
      teacher: 'المؤطّرة المسؤولة',
      // BR-23 و§20 قاعدة 22: السعة تُعلِم ولا تمنع — تُعرض ولا يُرفض بها حجز.
      roomCapacityHint: 'سعة القاعة {n} — للعلم فقط، ولا يُرفض بها أي حجز.',
      assistants: 'المؤطّرات المساعدات',
      // §4.4c: وصول المساعدة إلى المستفيدات مطابق لوصول المؤطّرة؛ الفرق في
      // الموقع لا في الصلاحية.
      assistantsHint: 'اختياري. للمساعدة الوصول نفسه إلى المستفيدات، ويبقى الفرق في الموقع.',
      fixedAfterCreate:
        'المادة ونمط التدريس وهدفه والفرع والسنة تُحدَّد عند الإنشاء ولا تُعدَّل — تغييرها يعيد توجيه حصص مُولّدة سابقاً.',
      clash: 'القاعة أو أحد المؤطرين مرتبط بحصة أخرى في نفس الوقت. اختر توقيتاً أو قاعة أخرى.',
      writeTitle: 'أثر الحفظ على الحصص',
      writeSummary: 'حصص مُنشأة: {created} — حصص محدَّثة: {resynced}.',
      protectedLede: 'حصص لم تُمَس لأنها تحمل عملاً فعلياً:',
      // القائمة الفارغة هنا نتيجة عادية ومطمئنة: لم يُستثنَ شيء لأن لا شيء احتاج استثناء.
      protectedNone: 'لم تُستثنَ أي حصة — لم تكن أي منها تحمل عملاً فعلياً.',
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
      viewSessions: 'الحصص',
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
      mapOpen: 'فتح الخريطة',
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
      // القاعات خلف كل فرع لا كقائمة مستقلة: القاعة لا معنى لها خارج فرعها.
      rooms: 'القاعات',
      roomsTitle: 'قاعات {branch}',
      roomsEmpty: 'لا توجد قاعات في هذا الفرع بعد. الجدول الذي يحدد قاعة يحتاج إلى واحدة على الأقل.',
      roomAdd: 'إضافة قاعة',
      roomRename: 'تعديل اسم القاعة',
      roomBlocked: 'لا يمكن حذف هذه القاعة لأن جداول أو حصص ما زالت تحجزها.',
      roomDeleteTitle: 'حذف القاعة',
      roomDeleteBody: 'سيتم حذف قاعة «{name}». لا يمكن الحذف ما دامت جداول أو حصص تحجزها.',
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
      // R49 — the stage the applicant asked for. The key was used by the table
      // and the filter and was never in the catalog, so `t()` fell back to
      // returning the PATH and both rendered `admin.approvals.colRequested`.
      colRequested: 'المرحلة المطلوبة',
      branchNone: 'غير مذكور',
      filterBranch: 'المقر',
      filterAllBranches: 'كل المقرات',
      colSubmitted: 'تاريخ الإرسال',
      filterType: 'نوع الطلب',
      filterAll: 'كل الأنواع',
      typeRegistration: 'تسجيل جديد',
      typeChild: 'طلب تسجيل ابن/ابنة',
      // R68 / §4.3 — a minor now has her own حساب. The links keep working until
      // an administrator decides, which is what "غير معطِّلة" has to convey.
      typeIdentityReview: 'مراجعة: أصبح للمستفيدة حساب خاص',
      childTitle: 'البتّ في طلب تسجيل الأبناء',
      childBody: 'يُبتّ في كل ابن/ابنة على حدة؛ يمكنك قبول واحد ورفض آخر في نفس الطلب.',
      childOutcome: 'القرار',
      childUndecided: 'دون قرار الآن',
      childReason: 'سبب الرفض',
      childReasonHint: 'يُبلَّغ ولي الأمر بهذا السبب، ولذلك فهو من لائحة محدَّدة.',
      childReason_duplicate_application: 'طلب مكرَّر',
      childReason_insufficient_information: 'معطيات غير كافية',
      childReason_not_eligible: 'لا تنطبق الشروط',
      childReason_other: 'سبب آخر',
      childDecided: 'تمّ البتّ في {n} من الطلبات.',
      childPartial: 'تمّ البتّ في {n} فقط؛ لم تُلغَ القرارات التي تمّت.',
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
      roleForbidden: 'إسناد أدوار الإدارة للمديرة العامة وحدها. يمكنك الموافقة دون إسناد دور.',
      staffTitle: 'الموافقة على طلب {names}',
      staffBody: 'طلب صاحب الحساب صفة «{role}». الصفة تُمنح الآن، لا تُمنح بالطلب.',
      grantRole: 'الدور الممنوح',
      grantRoleHint: 'مقترح من الطلب، وقابل للتعديل — القرار قرارك.',
      grantScopeHint: 'نطاق الصلاحية، وهو غير الفرع الذي طلبه صاحب الحساب.',
      approveWithRole: 'الموافقة مع إسناد الدور',
      approveWithoutRole: 'الموافقة دون دور',
      // §4.1 (المراجعة 43): الموافقة هي الإسناد نفسه، لا خطوة تالية له.
      placeTitle: 'الموافقة وإسناد المستوى',
      placeBody:
        'الموافقة تُدخل الطالبة إلى المدرسة فعليًا: تُسنَد إلى مستوى ومجموعة في المعاملة نفسها. حساب مقبول بلا إسناد يعني شخصًا قُبل ثم فُقد.',
      placeGroup: 'المجموعة',
      // R66.5 — a Level with no subdivision is placed by naming the branch.
      placeBranch: 'المقر',
      placeBranchHint: 'هذا المستوى غير مقسَّم إلى مجموعات، فيُسجَّل الطفل مباشرةً في المقر المختار.',
      placeNoGroups: 'لا توجد مجموعة حية في هذا المستوى، فلا يمكن الإسناد إليه.',
      anyCategory: 'كل الفئات',
      categoryRequested: 'الفئة المطلوبة: {category}. المستوى الأول منها مقترح، ويمكنك تغييره.',
      categoryNotStated: 'لم تُسجَّل فئة في هذا الطلب، فلا يوجد اقتراح.',
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
  // ── مفردات النطاق الدراسي (§4.4b, §4.4c, R43) ──────────────────────────
  //
  // مكان واحد لأسماء الحقول ولما تقوله القوائم حين تفرغ. الفرق بين «اختاري
  // المستوى أولًا» و«لا مواد مسندة إلى هذا المستوى» فرق حقيقي: الأولى تعليمة،
  // والثانية حقيقة عن المنهاج تُصلَح من شاشة أخرى.
  scope: {
    category: 'الفئة',
    level: 'المستوى',
    subject: 'المادة',
    branch: 'الفرع',
    academicYear: 'السنة الدراسية',
    group: 'الحلقة',
    choose: 'اختاري…',
    chooseFirst: 'اختاري {field} أولًا',
    all: {
      categoryId: 'كل الفئات',
      levelId: 'كل المستويات',
      subjectId: 'كل المواد',
      branchId: 'كل الفروع',
      academicYearId: 'كل السنوات',
      groupId: 'كل الحلقات',
    },
    empty: {
      categoryId: 'لا توجد فئات',
      levelId: 'لا توجد مستويات في هذه الفئة',
      subjectId: 'لا مواد مسندة إلى هذا المستوى',
      branchId: 'لا توجد فروع',
      academicYearId: 'لا توجد سنوات دراسية',
      groupId: 'لا حلقات لهذا المستوى في هذا الفرع',
    },
    // تُعرض حين يكون المستوى بلا مواد، وتدلّ على الشاشة التي تُسند المواد.
    assignSubjectsHint:
      'هذا المستوى لا يدرّس أي مادة بعد. افتحي «المستويات»، ثم من إجراءات المستوى اختاري «مواد المستوى» لإسناد المواد إليه.',
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
    // شاشة إدارة المحتوى (§5.5, §5.6) — المرفوع، والاستبدال، والحذف.
    caption: 'المحتوى التعليمي المرفوع',
    allLevels: 'كل المستويات',
    allSubjects: 'كل المواد',
    chooseLevelFirst: 'اختاري المستوى أولًا',
    levelTeachesNothing: 'لا مواد مسندة إلى هذا المستوى',
    replace: 'استبدال الملف',
    replaceTitle: 'استبدال الملف',
    // TD-9: مفتاح تخزين جديد، والملف السابق إلى الحجر — لا استبدال في مكانه.
    replaceExplainer:
      'يُرفع الملف الجديد بمفتاح تخزين جديد، ويُنقل الملف السابق إلى الحجر مدة تسعين يومًا. تبقى المادة نفسها بكل ارتباطاتها.',
    replaced: 'تم استبدال الملف.',
    uploaded: 'تم رفع الملف.',
    deleted: 'تم حذف المادة. يمكن استرجاعها من سلة المحذوفات خلال تسعين يومًا.',
    deleteFailed: 'تعذّر الحذف. يرجى إعادة المحاولة.',
    deleteTitle: 'حذف المادة',
    deleteBody:
      'سيتم حذف «{title}» وحفظ نسخة منها في سلة المحذوفات مدة تسعين يومًا قبل الحذف النهائي.',
    col: {
      title: 'العنوان',
      kind: 'النوع',
      visibility: 'الظهور',
      branch: 'الفرع',
      level: 'المستوى',
      subject: 'المادة',
      year: 'السنة الدراسية',
      size: 'الحجم',
      published: 'تاريخ النشر',
    },
    visibility: {
      public: 'عام',
      private: 'خاص',
      hidden: 'مخفي',
    },
    size: { kb: 'كيلوبايت', mb: 'ميغابايت' },
    upload: {
      action: 'رفع ملف',
      file: 'الملف',
      title: 'العنوان',
      description: 'الوصف',
      retry: 'إعادة المحاولة',
      // TD-9: السقوف والأنواع المقبولة، مذكورة قبل الاختيار لا بعد الرفض.
      limits:
        'التسجيلات الصوتية حتى 100 ميغابايت؛ المستندات والصور حتى 50 ميغابايت. الأنواع المقبولة: PDF وصور وصوت ومستندات Office. الفيديو غير مقبول.',
      // §4.9: المسجّل داخل التطبيق مؤجَّل — التسجيل يتم بتطبيق الهاتف ثم يُرفع.
      recordingGuidance:
        'للتسجيل الصوتي: سجّلي بتطبيق التسجيل في هاتفك ثم ارفعي الملف هنا. يُفضَّل التسجيل الأحادي بجودة منخفضة، وتقسيم الحصص الطويلة إلى ملفات أقصر.',
      chooseScope: 'اختاري المستوى والمادة والسنة الدراسية قبل الرفع.',
      // القاعدة هنا R43: المادة والمستوى معًا، ولا يقبل الخادم اقترانًا غير مسند.
      // الرسالة تدلّ على الشاشة التي تُصلح الحال بدل الاكتفاء بالرفض.
      //
      // **كانت تُحيل إلى شاشة «الفئات والمواد»، وهي إحالة خاطئة مرّتين:** تلك
      // الشاشة قُسمت إلى «الفئات» و«المواد» في R55، وقد صارتا اليوم تحت «الإدارة»
      // وللمشرف العام وحده — فكانت الرسالة ترسل المؤطِّرة إلى باب مغلق. والأهمّ
      // أنّ إسناد المادة إلى مستوى يتمّ أصلًا في «مواد المستوى»، لا في قائمة
      // المواد المرجعية.
      levelTeachesNothing:
        'لا توجد مواد مسندة إلى هذا المستوى. تُسنَد المواد من شاشة «مواد المستوى» داخل المستويات، ثم عودي للرفع.',
      teacherNeedsBranch: 'اختاري الفرع الذي يخصّه هذا المحتوى.',
      stage: {
        preparing: 'جارٍ التحضير…',
        finalising: 'جارٍ التحقّق من الملف…',
        done: 'تم',
      },
      // كل رسالة تقابل قاعدة يطبّقها الخادم — «فشل الرفع» وحدها تُخفي ما يلزم فعله.
      globalForbidden: 'لا يمكن للمؤطّرات نشر محتوى بدون فرع. اختاري فرعًا.',
      branchForbidden: 'هذا الفرع خارج نطاق الحصص التي تؤطّرينها.',
      subjectNotAtLevel: 'هذه المادة غير مسندة إلى هذا المستوى.',
      tooLarge: 'حجم الملف يتجاوز الحدّ المسموح به.',
      quotaExhausted: 'تجاوزتِ عدد الملفات المسموح برفعها في الساعة. يرجى المحاولة لاحقًا.',
      typeRejected: 'نوع الملف غير مقبول، أو أنّ محتواه لا يطابق امتداده.',
      incomplete: 'لم يكتمل رفع الملف. يرجى إعادة المحاولة.',
      networkFailed: 'انقطع الاتصال أثناء الرفع. يرجى إعادة المحاولة.',
      failed: 'تعذّر رفع الملف. يرجى إعادة المحاولة.',
    },
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
