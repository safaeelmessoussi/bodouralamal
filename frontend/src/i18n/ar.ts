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
    super_admin: 'مشرفة عامة',
    admin: 'مسؤولة',
    teacher: 'مؤطِّرة',
    parent: 'ولي الأمر',
    student: 'مستفيدة',
  },
  child: {
    switcherLabel: 'الطفل الحالي',
    switcherHint: 'اختر الطفل الذي تتابع بياناته',
    none: 'لا يوجد أطفال مرتبطون',
    // R64 — a PAGE (§14.1), not an item in the account switcher: a switcher
    // lists the contexts you may work in, and registering is a task.
    // The `＋` is the shared Add button's (`variant="add"`), not this label's.
    register: 'تسجيل طفل',
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
  student: {
    // R85 — قائمة المستفيدة: نفس معمار القائمة الجانبية في الإدارة والتدريس.
    nav: {
      label: 'أقسامي',
      dashboard: 'لوحة المستفيدة',
      calendar: 'تقويمي',
      content: 'مكتبة المحتوى',
      quran: 'حفظي',
      grades: 'نقاطي',
      account: 'حسابي',
    },
    // R86 — مكتبة المحتوى وحسابي داخل بوابة المستفيدة، لا صفحات عامة بلا قائمة.
    library: {
      lede: 'المحتوى التعليمي لمستوى {level}.',
      level: 'المستوى',
      title: 'العنوان',
      subject: 'المادة',
      open: 'فتح',
      noEnrolment: 'لا تسجيل فعّال بعد، فلا محتوى لعرضه.',
    },
    account: {
      lede: 'بياناتك وتسجيلاتك التعليمية.',
      identity: 'بياناتي',
      name: 'الاسم',
      reference: 'الرقم المرجعي',
      // بصيغة الجمع عن قصد: المستفيدة قد تسجَّل في أكثر من مستوى (BR-21).
      enrolments: 'التسجيلات التعليمية',
      noEnrolments: 'لا تسجيلات فعّالة.',
    },
    // §5.3 — نقاطي. PUBLISHED grades only; the draft is the مؤطِّرة's working
    // note (BR-8) and never reaches this surface. No pass/fail wording here by
    // decision (2026-08-17): the screen reports what she scored, not a verdict
    // about her — and the business rules that DO decide progression are
    // untouched in the model.
    grades: {
      title: 'نقاطي',
      lede: 'نقاطك في الامتحانات المنشورة. لكل امتحان نقطته القصوى.',
      caption: 'النقاط المنشورة',
      exam: 'الامتحان',
      date: 'التاريخ',
      subject: 'المادة',
      score: 'النقطة',
      absent: 'غائبة',
      empty: 'لا توجد نقاط منشورة بعد. تظهر النقطة هنا بعد أن تنشرها المؤطِّرة.',
    },
    quran: {
      title: 'حفظي',
      lede: 'ما سُجّل لك من حفظ ومراجعة. النسبة تُحتسب باتحاد المقاطع، فلا يرفعها تكرار المقطع نفسه.',
      empty: 'لا يوجد حفظ مسجّل بعد. تُسجّله المؤطِّرة بعد السماع.',
      history: 'السجل',
      noLogs: 'لا توجد سجلات.',
      surah: 'السورة',
      range: 'المقطع',
      category: 'النوع',
      newMemorization: 'حفظ جديد',
      revision: 'مراجعة',
    },
  },
  studentDashboard: {
    // R86 — الصفحة تبقى فارغة عن قصد حتى تُصمَّم؛ التفاصيل انتقلت إلى «حسابي».
    // 2026-08-20 — صارت وصفاً للصفحة تحت عنوانها، كما في مساحة التدريس، بعد أن
    // كان العنوان يُطبع مرّتين وتحته روابط تكرّر القائمة نفسها.
    landing: 'من القائمة تصلين إلى تقويمك ونقاط الامتحانات والمحتوى.',
    // R83.5 — تقويمها هي: حصص مستوياتها وأنشطة نطاقها، لا تقويم المنصّة كلّه.
    myCalendar: 'تقويمي',
    title: 'لوحة المستفيدة',
    viewingChild: 'تتابعين بيانات: {name}',
    chooseChild: 'اختاري الطفل الذي تتابعين بياناته من قائمة التبديل في الأعلى.',
    noChildren: 'لا يوجد أطفال معتمدون بعد.',
    // Unreferenced since R65 moved child registration to the personal section —
    // the Student Dashboard keeps no registration link. Kept as the catalogue's
    // record of the label, without the glyph the shared button now owns.
    registerChild: 'تسجيل ابن/ابنة',
    referenceCode: 'الرمز المرجعي',
    category: 'الفئة',
    level: 'المستوى',
    branch: 'المقر',
    notPlaced: 'لم يتم بعد إسناد فئة ومستوى. تتولى الإدارة ذلك بعد الموافقة.',
    moreEnrollments: 'وهناك {count} تسجيل آخر في مستوى مختلف.',
    upcoming: 'حصص اليوم والقادمة',
    /** The accessible name of the dashboard's own sub-navigation. */
    sections: 'أقسام لوحة المستفيدة',
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
      'نؤمن أن لكل واحدة نصيباً من العلم مهما كان سنّها أو ظرفها. لذلك نفتح حلقاتنا للكبار قبل الصغار، ونتابع تقدّم كل مستفيدة متابعةً فرديةً موثّقة، لا مجرّد حضورٍ في سجل.',

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
    remove: 'إزالة',
    noneChosen: 'لم تُختَر أي واحدة بعد.',
    noMatches: 'لا توجد نتائج.',
    searchPlaceholder: 'ابحث…',
    notSet: 'غير محدَّد',
    required: 'هذا الحقل مطلوب.',
    saved: 'تم الحفظ.',
    created: 'تمت الإضافة.',
    deleted: 'تم الحذف.',
    saveFailed: 'تعذّر الحفظ.',
    loadFailed: 'تعذّر تحميل البيانات.',
    breadcrumb: 'مسار التنقل',
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
    // Losing a half-filled form to a stray click is the defect these exist for
    // (2026-08-17). Phrased as a question about the FORM, not about the data:
    // nothing is being deleted, so the wording must not borrow the vocabulary of
    // deletion — «حذف» here would misdescribe what happens and would make the
    // real delete confirmations read as less serious.
    discardTitle: 'إغلاق النموذج؟',
    discardBody: 'هناك تغييرات لم تُحفظ بعد، وستُفقد عند الإغلاق.',
    discardConfirm: 'إغلاق دون حفظ',
    all: 'الكل',
    yes: 'نعم',
    no: 'لا',
    saving: 'جارٍ الإرسال…',
    pagination: 'تصفّح النتائج',
    previous: 'السابق',
    next: 'التالي',
    pageOf: 'صفحة {page} من {pages}',
    // R76.8 — «الترتيب» is no longer a number a user types; it is the sequence
    // of the rows. Every message below names the way OUT of the state, not only
    // the obstacle: a reader who cannot drag needs to know what to change.
    reorder: {
      column: 'تغيير الترتيب',
      handle: 'اسحبي لتغيير الترتيب، أو استعملي السهمين لأعلى وأسفل',
      hint: 'يمكنك تغيير ترتيب الصفوف بسحبها، أو بالسهمين لأعلى وأسفل بعد تحديد مقبض الصف.',
      saving: 'جارٍ حفظ الترتيب…',
      failed: 'تعذّر حفظ الترتيب. لم يتغيّر الترتيب المحفوظ.',
      blockedBySort: 'الترتيب اليدوي متاح في الترتيب الافتراضي فقط. أزيلي الفرز حسب العمود للعودة إليه.',
      blockedByPaging: 'الترتيب اليدوي يحتاج إلى ظهور جميع العناصر في صفحة واحدة.',
      // §2.2 — الترتيب محفوظ داخل الفئة أو داخل المستوى، لا عبر القائمة كلها.
      // الصياغة عامة لأنها تخدم الحالتين، والمُصفّي المقصود ظاهر أعلى الجدول.
      blockedByScope: 'الترتيب محفوظ داخل كل مجموعة على حدة. اختاري عنصرًا واحدًا من عوامل التصفية أعلاه لترتيب ما بداخله.',
    },
  },
  // §4.8 as narrowed by R77 — ONE event, so the wording names the class rather
  // than promising a stream of notice types this MVP does not have.
  notifications: {
    title: 'مستجدّات',
    unreadLabel: 'غير مقروءة',
    sessionCancelled: 'أُلغيت حصة {subject} ليوم {date} على الساعة {time}.',
    sessionRestored: 'عادت حصة {subject} ليوم {date} على الساعة {time} إلى الجدول.',
    // R78.4 — الإشعار يحمل الموعد الجديد، لأن إشعاراً يقول «تغيّر الموعد» فقط
    // لا يمكن لأحد أن يتصرّف بناءً عليه.
    sessionRescheduled: 'تغيّر موعد حصة {subject}. الموعد الجديد: {date} على الساعة {time}.',
    // R78.2 — تُرسَل لمن أُسنِدت إليه الحصة، ولا تُرسَل لمن قام بالإسناد بنفسه.
    sessionAssigned: 'أُسنِدت إليك حصة {subject} ليوم {date} على الساعة {time}.',
    // جرس الإشعارات في الشريط العلوي — متاح من كل شاشة، لا من لوحة واحدة.
    bell: 'الإشعارات',
    bellWithCount: 'الإشعارات — {n} غير مقروء',
    none: 'لا إشعارات بعد.',
    loading: 'جارٍ التحميل…',
    // R82/R83 — إشعارات الأنشطة والنقاط. الصياغة تذكر ما يلزم للتصرّف: ما هو،
    // ومتى، ولا تصف قراراً لم يُتّخذ.
    eventCreated: 'أُضيف نشاط «{subject}» يوم {date} على الساعة {time}.',
    eventRescheduled: 'غُيّر موعد نشاط «{subject}» إلى {date} على الساعة {time}.',
    eventCancelled: 'أُلغي نشاط «{subject}» الذي كان يوم {date}.',
    gradePublished: 'نُشرت نقطتك في «{subject}» ({date}).',
    theClass: 'الحصة',
    reason: 'السبب: {reason}',
    markRead: 'تم الاطّلاع',
  },
  // §4.9 as amended by R75 — the in-app recorder. The wording keeps the
  // phone-upload path visible everywhere the recorder is not available: it is
  // the stated remedy, not a consolation.
  recorder: {
    title: 'تسجيل صوتي',
    start: 'بدء التسجيل',
    pause: 'إيقاف مؤقّت',
    resume: 'استئناف',
    stop: 'إنهاء التسجيل',
    save: 'حفظ التسجيل',
    discard: 'حذف التسجيل',
    name: 'اسم التسجيل',
    nameHint: 'يُقترح اسم تلقائيًا من الحصة وتاريخها، ويمكنك تغييره.',
    // R75.7 — الخطر قائم ما دام التسجيل جاريًا، فالتنبيه دائم لا عابر.
    keepAwake: 'أبقي الشاشة مفتوحة وهذه الصفحة ظاهرة أثناء التسجيل. قفل الشاشة قد يقطع التسجيل دون إشعار.',
    wasBackgrounded: 'غادرتِ هذه الصفحة أثناء التسجيل، وقد يكون جزء منه ناقصًا. يُنصح بالاستماع إليه قبل الحفظ.',
    micDenied: 'تعذّر الوصول إلى الميكروفون. تحقّقي من إذن المتصفّح، أو سجّلي بهاتفك وارفعي الملف.',
    saveFailed: 'تعذّر حفظ التسجيل. التسجيل ما يزال محفوظًا هنا — أعيدي المحاولة.',
    unsupported: 'المتصفّح الحالي لا يدعم التسجيل الصوتي. يمكنك التسجيل بهاتفك ثم رفع الملف من «رفع مادة جديدة».',
    state: {
      idle: 'متوقّف',
      recording: 'جارٍ التسجيل',
      paused: 'موقوف مؤقّتًا',
      saving: 'جارٍ الحفظ',
    },
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
    mineEmpty: 'لا شيء في تقويمك هذا الشهر.',
    // نوع العنصر كما تعرضه الشارة في الجدول — نفس مفردات الجدولة.
    kind: {
      session: 'حصة',
      event: 'نشاط',
      exam: 'امتحان',
    },
    // R84 — «قائمة» جدول في كل السطوح: نفس لغة الجداول في المنصّة كلها.
    table: {
      caption: 'عناصر هذا الشهر',
      kind: 'النوع',
      title: 'العنوان',
      date: 'التاريخ',
      time: 'الوقت',
      level: 'المستوى',
      subject: 'المادة',
      audience: 'المعنيون',
      branch: 'المقر',
      room: 'القاعة',
      noBranch: 'خارج المقرات',
    },
    // تصفية موحّدة لكل التقاويم: نفس الحقول تصفّي «قائمة» و«تقويم» معاً.
    filters: {
      all: 'الكل',
      subject: 'المادة',
      type: 'النوع',
      group: 'المجموعة',
      circle: 'الحلقة',
    },
    previousMonth: 'الشهر السابق',
    nextMonth: 'الشهر التالي',
    dayDialogTitle: 'أنشطة اليوم',
    selectedDayEmpty: 'لا توجد أنشطة في هذا اليوم.',
    gridLabel: 'شبكة الشهر',
    loading: 'جارٍ تحميل الجدول…',
    error: 'تعذّر تحميل الجدول حالياً.',
    monthEmpty: 'لا توجد أنشطة مسجّلة في هذا الشهر.',
    // §4.4 — a cancelled occurrence STAYS on the calendar and says so: the
    // calendar's job is to report that a class is not happening, not to hide
    // that it was scheduled.
    cancelled: 'ملغاة',
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
    // The route from a class occurrence in the calendar to its own page, where
    // R43's `SessionContent` materials and recordings live (2026-08-17).
    detailsOpenSession: 'فتح صفحة الحصة وموادها',
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
      'سيصل طلبك إلى الإدارة لمراجعته. لا يمنحك إرسال الطلب أي صلاحية؛ تُسنَد صفة المؤطِّرة عند الموافقة.',
    kindHint: 'هذا السؤال عن **مَن** يُسجَّل، لا عن المرحلة التعليمية؛ تُحدَّد الفئة في الأسفل.',
    you: 'بياناتك',
    parent: 'بيانات ولي الأمر',
    child: 'بيانات الابن/الابنة',
    // R62.1 — one request may carry several children, decided one at a time.
    childAdd: 'إضافة ابن/ابنة',
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
      'المؤطِّرات والمسؤولات في الجمعية، كلٌّ في حدود عملها فقط: المؤطِّرة ترى مستفيدات حلقتها، والمسؤولة ترى فرعها. لا تُنشر بياناتك ولا تُباع ولا تُشارَك مع أي جهة خارجية.',
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
    // R83.5 — تقويم المؤطرة الشخصي: حصصها وأنشطتها هي، لا تقويم المنصّة كلّه.
    myCalendar: 'تقويمي',
    // مساحة التدريس تبقى بسيطة عن قصد حتى تُصمَّم؛ القائمة جانبها هي الطريق.
    homeLede: 'من القائمة تصلين إلى تقويمك وجداولك ونقاط الامتحانات والمحتوى وإدخال الحفظ.',
    schedules: {
      // R72 — the one kind TD-2 grants a مؤطرة on this screen.
      addActivity: 'نشاط جديد',
      lede: 'الجداول التي تؤطّرينها. لعرض المستفيدات اضغطي على الجدول.',
      caption: 'حصصي',
      empty: 'لا توجد جداول مسندة إليك حالياً.',
    },
    nav: {
      label: 'أقسام التدريس',
      dashboard: 'مساحة التدريس',
      // The BACK OFFICE's words for the same concepts (2026-08-17). «حصصي» and
      // «المحتوى التعليمي» named the same things the admin menu calls «الجدولة»
      // and «مكتبة المحتوى», so one platform had two vocabularies for one
      // concept and a مؤطرة could not tell she was looking at the same feature.
      // The PATHS are unchanged and so is her scope — `/teacher/schedules` and
      // `/teacher/content` — because the words were what differed, not the
      // authorization.
      schedules: 'الجدولة',
      content: 'مكتبة المحتوى',
      exams: 'نقاط الامتحانات',
      // R85 — «إدخال الحفظ»: the Owner's word, and the operational one. «تتبع»
      // describes watching; this screen is where a مؤطرة RECORDS what was
      // memorised, which is what she comes to it to do.
      quran: 'إدخال الحفظ',
      calendar: 'تقويمي',
    },
    /** §14.1's grouping, applied to the teaching branch — the same headings the
     *  back-office sidebar uses, so the two portals read alike. */
    section: {
      teaching: 'التدريس',
      scheduling: 'الجدولة',
      content: 'المحتوى',
    },
    // Each names WHAT is missing. The schedules entry names a specification gap
    // rather than unbuilt UI, because that is the honest reason.
    quran: {
      lede: 'تسجيل ما حفظته المستفيدة ومراجعتها. النسبة تُحتسب باتحاد المقاطع، فلا يرفعها تكرار المقطع نفسه.',
      student: 'المستفيدة',
      // The dropdown gate is gone: the page lists the مستفيدات in her scope
      // (2026-08-17). What remains is the TABLE's vocabulary.
      caption: 'المستفيدات في نطاق تأطيرك',
      colStudent: 'المستفيدة',
      searchPlaceholder: 'ابحثي باسم المستفيدة…',
      openStudent: 'الحفظ',
      backToStudents: 'كل المستفيدات',
      noStudents: 'لا توجد مستفيدات تُدرّسين لهنّ القرآن.',
      outOfScope: 'هذه المستفيدة خارج نطاق تدريسك للقرآن.',
      surah: 'السورة',
      startAyah: 'من الآية',
      endAyah: 'إلى الآية',
      rangeHint: 'المقطع يشمل الآيتين معًا.',
      category: 'النوع',
      newMemorization: 'حفظ جديد',
      revision: 'مراجعة',
      log: 'تسجيل المقطع',
      logged: 'سُجّل المقطع وحُدّثت النسبة.',
      deleted: 'حُذف السجل وأُعيد احتساب النسبة.',
      coverage: 'نسبة الحفظ',
      noProgress: 'لا يوجد حفظ مسجّل بعد.',
      history: 'السجل',
      noLogs: 'لا توجد سجلات.',
      range: 'المقطع',
      loggedBy: 'سجّلته',
      deleteTitle: 'حذف السجل',
      deleteBody: 'سيُعاد احتساب نسبة الحفظ بعد الحذف.',
      ayahOutOfRange: 'رقم الآية يتجاوز عدد آيات السورة.',
      invalidRange: 'الآية الأخيرة قبل الأولى.',
    },
    exams: {
      lede: 'الامتحانات التي تدخل في نطاق تدريسك. افتحي امتحانًا لإدخال النقاط.',
      empty: 'لا توجد امتحانات في نطاق تدريسك.',
      backToList: 'العودة إلى قائمة الامتحانات',
    },
    blocked: {
      dashboard: 'تُبنى واجهات مساحة التدريس بعد اكتمال شاشات الحصص.',
      content: 'يتطلب هذا القسم واجهات رفع المحتوى (المرحلة السادسة)، وهي غير متوفرة بعد.',
      // R70 — the marking half is built; only §4.6's ONLINE paper builder is
      // still declared and refused, so the reason names that and not grading.
      exams: 'بناء الامتحانات عن بُعد غير متوفر بعد؛ إدخال النقاط متاح.',
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
    // R86 — يُعرَض محتوى الحصة داخل النافذة مباشرة، لا خلف رابط.
    attachments: 'المواد المرفقة',
    noMaterials: 'لا تسجيلات ولا مواد مرفقة بهذه الحصة.',
    // إدارة مواد الحصة (§4.9, TD-3.12). الإزالة تفكّ الارتباط ولا تحذف الملف.
    // **«المواد» said nothing about what the action does** (Owner, 2026-08-17):
    // on a row of class sessions it reads as *subjects*, which is a different
    // concept entirely (`مواد المستوى`). The label names the act — attaching
    // educational content to this session — and the short form is chosen because
    // it sits in a row-action cell beside تعديل and إلغاء, where the platform's
    // other action labels are two words at most.
    materialsAction: 'إرفاق محتوى',
    materialsTitle: 'مواد الحصة',
    materialsNone: 'لا توجد مواد مرفقة بهذه الحصة.',
    materialsLink: 'إرفاق',
    materialsLinkExisting: 'إرفاق مادة موجودة',
    // The picker's own empty answer: every library item in this session's scope
    // is already attached. Distinct from "no library items exist".
    materialsNoneToAdd: 'كل محتوى هذا المستوى والمادة مرفق بالحصة أصلًا.',
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
    // R82.5 — الإشعار اختياري ويُقرَّر بعد الحفظ: التغيير محفوظ في الحالتين.
    notify: {
      title: 'إشعار المعنيين',
      body: 'هل تريدين إشعار جميع المعنيين بهذا التغيير؟',
      audience:
        'يُحدَّد المعنيون من نطاق النشاط نفسه: المستفيدات المسجّلات فيه والمؤطرات المسندات إليه. لا يصلك إشعار عن إجراء قمتِ به.',
      send: 'إرسال الإشعار',
      skip: 'بدون إشعار',
      sent: 'أُرسل الإشعار إلى {n} من المعنيين.',
      // **صفر ليس نجاحاً صامتاً.** «أُرسل الإشعار إلى 0» تُقرأ كنجاح، وهي في
      // الواقع إجابة: لا أحد معنيّ بهذا التغيير غيرك. الحالة الحقيقية التي
      // أظهرت هذا: المستفيدة الوحيدة المسجّلة في المستوى بهذا الفرع هي صاحبة
      // الإجراء نفسها، ولا يصل أحداً إشعار عن إجراء قام به.
      sentNone:
        'لم يُرسل أي إشعار: لا أحد معنيّ بهذا التغيير غيرك. تحقّقي من تسجيلات المستفيدات في هذا المستوى والفرع.',
      skipped: 'حُفظ التغيير بدون إرسال إشعار.',
      failed: 'حُفظ التغيير، لكن تعذّر إرسال الإشعار. يمكنك المحاولة لاحقاً.',
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
      // R81 — «النقطة القصوى» بدل أيّ سُلّم عام: لكل امتحان مجاله الخاص.
      maxGrade: 'النقطة القصوى',
      maxGradeHint:
        'أعلى نقطة يمكن أن تنالها المستفيدة في هذا الامتحان — 20 أو 10 أو 100. تُعرض النقاط بعدها على هذا الأساس: 15 من 20. لا يمكن جعلها أقلّ من نقطة سُجّلت فعلًا.',
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
      enrollments: 'التسجيلات',
      // R88 correction — التسجيلات places the people being taught; this
      // manages the people doing the teaching. Both belong to الشؤون التعليمية.
      teachers: 'إدارة المؤطِّرات',
      examGrades: 'نقاط الامتحانات',
      levelSubjects: 'مواد المستوى',
      levelSurahs: 'مقرر الحفظ',
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
      // NAMED rather than counted, because the reason to show the pairing is that
      // it is what refuses deletion — and the remedy needs to know which Levels.
      colSubjectLevels: 'المستويات التي تُدرَّس فيها',
      noLevels: 'غير مسندة إلى أي مستوى',
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
      responsible: 'المؤطِّرة المسؤولة',
      eventAssistants: 'المؤطِّرات المساعدات',
      eventAssistantsHint: 'المسؤولة تدير النشاط؛ المساعدات يطّلعن عليه دون تعديله.',
      staffAdminOnly: 'إسناد المسؤولية عن النشاط من صلاحيات الإدارة.',
      scopeFixed: 'النطاق يُحدَّد عند الإنشاء ولا يُعدَّل.',
      scopeCategory: 'فئة',
      scopeGroup: 'مجموعة مستوى',
      scopeLevel: 'مستوى',
      scopeHint: 'يُحدَّد عند الإنشاء فقط.',
      scopeLocked: 'لا يمكن تغيير نطاق النشاط بعد إنشائه — تغيير الجمهور إعادة إنشاء لا تعديل.',
      deleted: 'تم حذف النشاط.',
      deleteTitle: 'حذف النشاط',
      deleteBody: 'سيتم حذف نشاط «{title}» وكل مواعيده من الجدول.',
    },
    // §4.4 (المراجعة 50): كل عملية قد تمسّ سلسلة متكررة تسأل عن نطاقها أولًا.
    sessions: {
      // **R91 §11 — the one-off cover.** The words say *this occurrence*, because
      // that is exactly the thing an administrator would otherwise have to infer
      // from what did not change.
      staffAction: 'مؤطّرة هذه الحصة',
      staffTitle: 'مؤطّرة حصة {date}',
      staffHint:
        'يخص هذه الحصة وحدها. لا يتغيّر إسناد الحصص المتكرّرة، وتعود الحصة التالية إلى المؤطّرة المعتادة.',
      staffSaved: 'حُفظت مؤطّرة هذه الحصة.',
      // **R92 — من يحضر هذه الحصة، لا أين تُعقد.** الفصل بين الأمرين مقصود:
      // المكان يبقى كما هو، والحضور وحده هو ما يُعدَّل هنا.
      audienceAction: 'الحضور من الفروع',
      audienceTitle: 'الحضور في حصة {date}',
      audienceHint:
        'يخص هذه الحصة وحدها. تُعقد الحصة في مكانها المعتاد، ويمكن أن يحضرها مستفيدات من أكثر من فرع. الحصص القادمة تعود إلى وضعها الطبيعي.',
      audienceVenue: 'مكان الحصة:',
      audienceBranches: 'الفروع الحاضرة',
      audienceBranchesHint:
        'القائمة المختارة هي حضور هذه الحصة. لإرجاعها إلى الوضع المعتاد، أزيلي كل الفروع.',
      audienceCount: '{n} مستفيدة متوقّعة',
      audienceOverridden: 'حضور خاص بهذه الحصة',
      audienceSaved: 'حُفظ حضور هذه الحصة.',
      audienceSaveFailed: 'تعذّر حفظ الحضور. تحقّقي من الفروع المختارة.',
      audienceLoadFailed: 'تعذّر تحميل حضور هذه الحصة.',
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
      // R83.2 — السبب اختياري: أحياناً لا تُعقد الحصة دون تفصيل، واشتراط جملة
      // قبل تسجيل ذلك بوّابة بلا فائدة. R83.1 — الحصة الملغاة تختفي من التقويم.
      cancelBody:
        'تختفي هذه الحصة من التقاويم، وتبقى بقية حصص الجدول كما هي. السبب اختياري، ويظهر في الإشعار إن كُتب.',
      cancelReason: 'سبب الإلغاء (اختياري)',
      cancelReasonHint: 'اختياري — يُسجَّل في سجل التدقيق ويظهر في الإشعار إن كُتب.',
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
    // R88 — الملف التدريسي: بيانات تخطيط لا صلاحيات. الإسناد وحده يمنح الصلاحية.
    teachers: {
      lede: 'المؤطِّرات وما تستطيع كلٌّ منهن تدريسه والأوقات التي تتاح فيها. بيانات تخطيط تُعين على اختيار الإسناد؛ الصلاحية تأتي من إسناد الحصة نفسه.',
      caption: 'المؤطِّرات',
      // عناوين الأعمدة موجزة عمدًا؛ الشرح الكامل داخل الملف التدريسي.
      colSubjects: 'المواد',
      colCategories: 'الفئات',
      colAvailability: 'الأوقات المتاحة',
      filterSubject: 'المادة',
      filterCategory: 'الفئة',
      noAvailability: 'لم تُسجَّل',
      ranges: '{n} فترة',
    },
    teachingProfile: {
      action: 'الملف التدريسي',
      title: 'الملف التدريسي — {name}',
      planningOnly:
        'هذه بيانات تخطيط تساعد الإدارة على اختيار الإسناد. لا تمنح بذاتها أيّ صلاحية: الصلاحية تأتي من إسناد الحصة فعلاً.',
      subjects: 'المواد التي يمكنها تدريسها',
      categories: 'الفئات',
      availability: 'الأوقات المتاحة',
      noAvailability: 'لم تُسجَّل أوقات بعد.',
      addRange: 'إضافة فترة',
      weekday: 'اليوم',
      from: 'من',
      to: 'إلى',
      saved: 'حُفظ الملف التدريسي.',
      saveFailed: 'تعذّر حفظ الملف التدريسي. تحقّقي من الفترات: لا يجوز تداخلها.',
      loadFailed: 'تعذّر تحميل الملف التدريسي.',
    },
    users: {
      // **The pre-provisioning dialog's strings are gone with it** (2026-08-17):
      // `create`, `created`, `emailHint`, `emailInvalid`, `noRole` and
      // `createRoleHint`. The Document Owner removed staff-composed account
      // creation from this screen, and a dead catalogue entry is not harmless —
      // it ships in the bundle and is exactly what a future screen picks up and
      // renders, which is how "do not create an alternative account-creation UI
      // elsewhere" gets defeated by convenience. `POST /admin/users` and the
      // `createUser` adapter are untouched.
      lede: 'إدارة الحسابات: البحث والتصفية والإنشاء والتعديل وإسناد الأدوار والنطاقات وإيقاف الحسابات.',
      caption: 'المستخدمون',
      colEmail: 'البريد الإلكتروني',
      colBranches: 'الفروع',
      noEmail: 'لا بريد (حساب بلا دخول)',
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
      // حساب بلا دور يستطيع الدخول ولا يصل إلى شيء — تُذكر الحالة لا تُخفى.
      noRoles: 'بلا دور',
      noRolesWarning: 'هذا الحساب بلا أي دور. سيتمكن صاحبه من الدخول دون الوصول إلى أي شيء.',
      // R71 audit — this dictionary had drifted from `role.*` above: «أستاذة»
      // for a مؤطرة and a second spelling of every other label. One concept,
      // one set of words; the association's own, which §2.1 already uses.
      role: {
        super_admin: 'مشرفة عامة',
        admin: 'مسؤولة',
        teacher: 'مؤطِّرة',
        student: 'مستفيدة',
        parent: 'ولي أمر',
      },
      status: {
        pending: 'بانتظار الموافقة',
        active: 'نشط',
        suspended: 'موقوف',
        rejected: 'مرفوض',
      },
      email: 'بريد Google',
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
      // **Corrected 2026-08-17: the old text described behaviour that no longer
      // exists.** It promised that creating a Level also creates «المجموعة 1» in
      // a chosen branch — true before R66 made the Administrative Group optional,
      // and false since. `createLevel` creates a Level and nothing else, and the
      // success notice already says what to do next. A description that overstates
      // what an action does is worse than none: it teaches a rule the platform
      // does not have.
      lede: 'المستويات داخل كل فئة، وهي ما تُسجَّل فيه المستفيدات. المستوى يُنشأ وحده؛ وتقسيمه إلى مجموعات أو حلقات خطوة مستقلة تُتخذ عند الحاجة إليها فقط.',
      caption: 'المستويات',
      create: 'إضافة مستوى',
      editTitle: 'تعديل المستوى',
      colName: 'الاسم',
      colCategory: 'الفئة',
      colGender: 'الفئة المستهدفة',
      colStudents: 'المستفيدات المسجلات',
      allCategories: 'كل الفئات',
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
      created: 'تمّ إنشاء المستوى. أنشئي مجموعة له عند الحاجة إلى تقسيمه.',
      createdWithGroup: 'تم إنشاء المستوى، ومعه «{group}» في فرع {branch}.',
      deleted: 'تم حذف المستوى ومجموعاته الفارغة.',
      deleteTitle: 'حذف المستوى',
      deleteBody: 'سيتم حذف المستوى «{name}» ومجموعاته الفارغة معه.',
      deleteBodyEnrolled:
        'المستوى «{name}» يضم {n} مستفيدة مسجلة، ولا يمكن حذفه قبل نقلهن إلى مستوى آخر.',
      deleteBlocked:
        'تعذّر الحذف: ما زالت هناك تسجيلات أو حلقات أو جداول أو امتحانات أو محتوى مرتبط بهذا المستوى.',
    },
    enrollments: {
      lede: 'تسجيل المستفيدات في المستويات. المجموعة والحلقات اختيارية: المستوى غير المقسّم يُسجَّل فيه مباشرة.',
      // The `＋` is the shared Add button's now (`variant="add"`), not this
      // string's: a glyph typed into a label is a glyph one screen can forget.
      add: 'تسجيل مستفيدة',
      student: 'المستفيدة',
      searchHint: 'ابحثي بالاسم…',
      // تعديل التسجيل يغيّر التوزيع داخل التسجيل، لا هويّته.
      identityFixed:
        'المستوى والمقر لا يُعدَّلان هنا. لنقل المستفيدة إلى مستوى أو مقر آخر: أنهي هذا التسجيل ثم سجّليها من جديد.',
      // الاتجاه: المستفيدة أولاً، ثم المستويات المتاحة لها (R27 + BR-21).
      // المستوى المسجَّلة فيه أصلاً لا يُعرَض، وباقي المستويات تبقى متاحة.
      levelsForStudent: 'تُعرَض المستويات المتاحة لهذه المستفيدة.',
      noLevelsForStudent: 'لا يوجد مستوى متاح لهذه المستفيدة حالياً.',
      branch: 'المقر',
      caption: 'تسجيلات المستفيدات',
      searchPlaceholder: 'ابحثي باسم المستفيدة…',
      filterLevel: 'تصفية بالمستوى',
      allLevels: 'كل المستويات',
      noGroup: 'المستوى مباشرة',
      levelOnly: 'المستوى مباشرة (بلا مجموعة)',
      // The internal revision number is gone. It said «بعد المراجعة 66» — a
      // number no reader of this screen can look up, and the platform's own
      // rule is that engineering references never reach a user-facing surface.
      // What replaces it is the MEANING that revision carries.
      groupHint: 'اتركيها فارغة لتسجيلها في المستوى مباشرة.',
      enrolled: 'تم التسجيل.',
      already: 'المستفيدة مسجّلة في هذا المستوى أصلًا.',
      outOfScope: 'المستوى أو المقر أو المجموعة خارج نطاقك.',
      circles: 'الحلقات',
      noCircles: 'لا حلقات',
      editTitle: 'تعديل التسجيل',
      updated: 'حُدِّث التسجيل.',
      levelFixed:
        'المستوى لا يُعدَّل هنا: التسجيل هو ارتباط المستفيدة بمستوى بعينه، فالانتقال إلى مستوى آخر يكون بإنهاء هذا التسجيل وإنشاء غيره.',
      seatsWarning: 'تغيير المجموعة يُخرج المستفيدة من حلقاتها في هذا المستوى.',

      // ── الحلقات داخل نموذج التسجيل ──────────────────────────────────────
      // The circles are offered in the placement form because that is where a
      // مستفيدة's placement is decided. They remain a SEPARATE relationship:
      // the form makes two calls in order, and nothing links a group to a
      // circle (§4.4c).
      circlesOptional: 'الحلقات (اختيارية)',
      circlesHint:
        'الحلقة تقسيم للمادة داخل المستوى، ومستقلة تمامًا عن المجموعة: يمكن أن تكون المستفيدة في مجموعة وفي حلقات موادّ مختلفة. اتركيها فارغة إن كانت المادة تُدرَّس للمستوى كاملاً.',
      circlesPickLevel: 'اختاري المستوى أولًا لعرض حلقاته.',
      circlesNone: 'لا توجد حلقات في هذا المستوى — تُدرَّس مواده للمستوى كاملاً.',
      enrolledWithCircles: 'تم التسجيل، وأُسندت المستفيدة إلى {n} حلقة.',
      enrolledCirclesPartly:
        'تم التسجيل، لكن تعذّر إسناد المستفيدة إلى بعض الحلقات. أسنديها من صفحة حلقات المواد.',
      updatedCirclesPartly:
        'حُدِّث التسجيل، لكن تعذّر تعديل بعض الحلقات. راجعيها من صفحة حلقات المواد.',
      // R66 — الفرع صار عمودًا على التسجيل نفسه، فالمستفيدة المسجّلة في المستوى
      // مباشرة لها فرع أيضًا. أما مع المجموعة فالفرع فرعُها (§7).
      branchHint: 'مقر المستفيدة في هذا المستوى. يُعدَّل هنا لأن التسجيل في المستوى مباشرة.',
      branchFromGroup: 'المقر مأخوذ من المجموعة المختارة، فلا يُعدَّل هنا.',

      // ── إنهاء التسجيل ───────────────────────────────────────────────────
      // Audited 2026-08-17: the implementation matches the SRS. What was
      // missing was the distinction between MOVING a placement and ENDING the
      // enrolment, so the copy now names both, and states what is kept — a
      // reader deciding on an irreversible-sounding action deserves to know it
      // is recoverable, and from where.
      end: 'إنهاء التسجيل',
      endTitle: 'إنهاء تسجيل المستفيدة في هذا المستوى',
      endBody:
        'ينتهي هذا التسجيل وحده: هذا المستوى في هذا المقر. المستفيدة نفسها تبقى في المنصّة، وتسجيلاتها في المستويات الأخرى تبقى كما هي.',
      endKeptTitle: 'ما يبقى محفوظًا',
      endKept:
        'المستفيدة نفسها لا تُحذف · تسجيلاتها في المستويات الأخرى تبقى · نقاط الامتحانات وسجل الحفظ لا تُحذف · السجل يُنقل إلى سلة المحذوفات ويمكن للمشرف العام استرجاعه · يُسجَّل الإجراء في سجل المراجعة باسم من نفّذه.',
      endRemovedTitle: 'ما ينتهي',
      endRemoved:
        'عضوية هذا المستوى في هذا المقر · مقعد المجموعة الإدارية ومقاعد حلقات موادّ هذا المستوى تُخلى · ظهور المستفيدة في نطاق امتحانات المستوى وجداوله.',
      endNextTitle: 'وبعد الإنهاء',
      endNext:
        'يمكن تسجيل المستفيدة من جديد في أيّ مستوى أو مقر عبر «تسجيل مستفيدة». وهذه هي طريقة نقلها إلى مستوى أو مقر آخر، لأنّ المستوى والمقر جزء من هويّة التسجيل نفسه ولا يُعدَّلان.',
      ended: 'أُنهي التسجيل.',
    },
    grades: {
      // The page lists exams and opens one; the lede describes the page, not
      // whichever sheet happens to be open (2026-08-17).
      lede: 'نقاط امتحانات المستفيدات. النقطة من {scale} والحفظ مسودة حتى النشر.',
      ledeList: 'نقاط امتحانات المستفيدات. افتحي امتحانًا لإدخال نقاطه؛ لكل امتحان نقطته القصوى.',
      caption: 'الامتحانات ونقاطها',
      // **The exam table's own column headers** (2026-08-17). The table was
      // reading `admin.schedules.title`, `admin.exams.date` and
      // `admin.exams.audience` — none of which exist, so `t()` rendered the keys
      // themselves as headers. `admin.exams` is not a namespace at all
      // (`teacher.exams` is), and `admin.schedules` has `subject` but no `title`.
      // The headers belong to `admin.grades`, which owns this table.
      colDate: 'التاريخ',
      colAudience: 'الفئة المعنية',
      exam: 'الامتحان',
      examSummary: 'بيانات الامتحان',
      // `حلقات المواد` established it and this screen adopts it: the primary
      // action names where scheduling actually lives rather than pretending
      // this page owns it (§20 rule 16 — no invented capability).
      scheduleExam: 'جدولة امتحان',
      scheduleHint: 'تُجدول الامتحانات في صفحة الجدولة، ثم تُدخل نقاطها هنا.',
      backToList: 'كل الامتحانات',
      filterLevel: 'تصفية بالمستوى',
      allLevels: 'كل المستويات',
      searchPlaceholder: 'ابحثي بعنوان الامتحان…',
      empty: 'لا توجد امتحانات في نطاقك بعد. تُجدول الامتحانات في صفحة الجدولة.',
      open: 'النقاط',
      student: 'المستفيدة',
      mark: 'النقطة (من {scale})',
      absent: 'غائبة',
      status: 'الحالة',
      // `passed` / `failed` are deliberately GONE from this catalogue (Owner
      // decision, 2026-08-17). `Grade.passed` and BR-12's override remain in
      // the model and still decide retakes and progression; what is removed is
      // labelling a مستفيدة «راسبة» on a grade sheet. A guard asserts the two
      // keys stay absent, because re-adding them is a one-line regression.
      statusDraft: 'مسودة',
      statusPublished: 'منشورة',
      wholeLevel: 'المستوى كامل',
      recordedLate: 'سُجّل لاحقًا',
      save: 'حفظ كمسودة',
      publish: 'نشر النقاط',
      republish: 'إعادة النشر',
      saved: 'حُفظت النقاط كمسودة.',
      savedWithAbsent: 'حُفظت النقاط كمسودة. سُجّلت {n} مستفيدة غائبة بنقطة صفر.',
      published: 'نُشرت نقاط {n} مستفيدة.',
      republished: 'أُعيد نشر نقاط {n} مستفيدة.',
      noStudents:
        'لا توجد مستفيدات في نطاق هذا الامتحان. نطاقه هو المسجّلات في مستواه بمقره — أو مجموعته إن حُدّدت — فإن لم تكن أي مستفيدة مسجّلة هناك تبقى الورقة فارغة.',
      noStudentsAction: 'إدارة التسجيلات',
      nothingToPublish: 'لا توجد نقاط لنشرها. احفظي النقاط كمسودة أولًا.',
      notInAudience: 'إحدى المستفيدات ليست ضمن نطاق هذا الامتحان.',
      versionConflict: 'عُدّلت النقاط من جهة أخرى. أعيدي تحميل الصفحة.',
      outOfScope: 'هذا الامتحان خارج نطاق تدريسك.',
    },
    levelSurahs: {
      lede: 'السور المقرّرة على كل مستوى، وما أتمّته المستفيدات منها. إتمام المستوى يعني تغطية كل سورة مقرّرة بنسبة 100%.',
      // The table (2026-08-17): every Level and its Surahs on arrival, rather
      // than an accordion whose Surahs appeared only once a Level was opened.
      caption: 'مقرّر الحفظ لكل مستوى',
      colLevel: 'المستوى',
      colSurahs: 'السور المقرّرة',
      searchPlaceholder: 'ابحثي باسم المستوى أو الفئة…',
      filterCategory: 'تصفية بالفئة',
      allCategories: 'كل الفئات',
      noneYet: 'لا مقرّر بعد',
      syllabus: 'السور المقرّرة',
      configure: 'تعديل المقرّر',
      configureTitle: 'السور المقرّرة على المستوى',
      configureHint: 'اختاري السور التي يشملها مقرّر الحفظ في هذا المستوى.',
      saved: 'حُفظ المقرّر.',
      superAdminOnly: 'تعديل المقرّر من صلاحيات المشرفة العامة.',
    },
    levelSubjects: {
      lede: 'المواد التي تُدرَّس في هذا المستوى. المادة غير المسندة هنا لا يمكن إنشاء حلقة أو جدول لها.',
      // The dropdown gate is gone: the page lists every Level with its Subjects
      // (2026-08-17). What remains is the TABLE's vocabulary.
      caption: 'مواد كل مستوى',
      colLevel: 'المستوى',
      colSubjects: 'المواد المُدرَّسة',
      searchPlaceholder: 'ابحثي باسم المستوى أو المادة…',
      filterCategory: 'تصفية بالفئة',
      allCategories: 'كل الفئات',
      noneYet: 'لا مواد بعد',
      manage: 'تعديل المواد',
      manageTitle: 'مواد المستوى',
      saved: 'حُفظت مواد المستوى.',
      superAdminOnly: 'تعديل مواد المستوى من صلاحيات المشرفة العامة.',
      organiseHint: 'تقسيم المادة إلى حلقات يتم في',
      // Names WHICH subject was refused: this is a set-at-a-time control, so
      // «تعذّرت إحدى الإزالات» would leave the reader to find out which by trying.
      removeBlockedNamed:
        'حُفظت المواد، لكن تعذّرت إزالة: {names} — لأن لها حلقات أو جداول في هذا المستوى. أزيلي الحلقات أولًا.',
      addHint: 'المادة المسندة تُدرَّس لكل المستوى ما لم تُقسَّم إلى حلقات.',
      empty: 'لا تُدرَّس في هذا المستوى أي مادة بعد. أسندي مادة قبل إنشاء الحلقات أو الجداول.',
    },
    groups: {
      lede: 'المجموعات الإدارية داخل كل مستوى. المجموعة تنظيمية فقط: لا قاعة ولا أستاذ ولا سعة.',
      caption: 'المجموعات الإدارية',
      create: 'إضافة مجموعة',
      editTitle: 'تعديل المجموعة',
      colName: 'الاسم',
      colLevel: 'المستوى',
      colBranch: 'الفرع',
      // States the consequence: these are re-creations, not edits.
      fixedAfterCreate: 'المستوى والفرع يُحدَّدان عند الإنشاء ولا يُعدَّلان — النقل إعادة إنشاء.',
      roster: 'المستفيدات',
      rosterTitle: 'مستفيدات المجموعة',
      rosterEmpty: 'لا توجد مستفيدات في هذه المجموعة.',
      rosterCurrent: 'المسجّلات في المجموعة',
      // The picker shows its candidates on opening and the search NARROWS them.
      // It used to return nothing until two characters had been typed, so a
      // reader who did not already know a name had no way in (2026-08-17).
      findStudent: 'إضافة مستفيدة إلى المجموعة',
      findStudentHint:
        'كل الحسابات النشطة معروضة، ومن هنّ في المجموعة أصلًا مستثنيات. المستفيدة المسجّلة في مجموعة أخرى داخل نفس المستوى تُرفض عند الإضافة — النقل يتم بإخراجها أولًا.',
      noCandidates: 'لا توجد حسابات نشطة يمكن إضافتها.',
      enrol: 'تسجيل',
      unenrol: 'إخراج',
      alreadyInLevel: 'المستفيدة مسجّلة في مجموعة أخرى داخل نفس المستوى. النقل يتم بإخراجها أولاً.',
      deleteTitle: 'حذف المجموعة',
      deleteBody: 'لا يمكن حذف مجموعة تضم مستفيدات أو يستهدفها جدول حصص.',
      // Each refusal names its own cause — "فشل الحفظ" would hide which.
      refused_ENROLMENTS_EXIST: 'لا يمكن الحذف: المجموعة تضم مستفيدات مسجّلات.',
      refused_SCHEDULES_EXIST: 'لا يمكن الحذف: يستهدف هذه المجموعة جدول حصص.',
      // R66 retired `LAST_GROUP_IN_LEVEL`; the server can no longer send it, so
      // the string it would have rendered is gone with it.
    },
    subjectOrg: {
      title: 'حلقات مادة «{subject}»',
      lede: 'داخل مستوى «{level}». تُنشأ الحلقة فقط عند الحاجة إلى تقسيم المستوى؛ وبدونها تُدرَّس المادة للمستوى كاملاً.',
      // The `＋` is the shared Add button's (`variant="add"`), not this string's.
      create: 'إضافة حلقة',
      editTitle: 'تعديل الحلقة',

      // ── The flat table (2026-08-17) ─────────────────────────────────────
      // The accordion showed its data but not as a list: there was no way to see
      // what circles existed without opening Levels one at a time. The table
      // answers that in one read; the Level's own breakdown — its groups, its
      // subjects, BR-22's unassigned alarm — is what a row opens.
      overviewLede:
        'حلقات المواد في كل المستويات. الحلقة تقسيم للمادة داخل المستوى، ولا تُنشأ إلا عند الحاجة إلى تقسيمها؛ وبدونها تُدرَّس المادة للمستوى كاملاً.',
      caption: 'حلقات المواد',
      colCircle: 'الحلقة',
      colLevel: 'المستوى',
      colSubject: 'المادة',
      colMembers: 'المستفيدات',
      searchPlaceholder: 'ابحثي باسم الحلقة أو المستوى أو المادة…',
      filterCategory: 'تصفية بالفئة',
      allCategories: 'كل الفئات',
      filterLevel: 'تصفية بالمستوى',
      allLevels: 'كل المستويات',
      filterSubject: 'تصفية بالمادة',
      allSubjects: 'كل المواد',
      empty: 'لا توجد حلقات بعد. تُدرَّس كل مادة للمستوى كاملاً حتى تُنشأ لها حلقات.',
      // **«المستفيدات» replaced «تفاصيل المستوى»** (Owner decision, 2026-08-17):
      // the row is a CIRCLE, and its roster is what an administrator comes to
      // this table to manage — the same act «مستفيدات المجموعة» performs for an
      // Administrative Group, on the independent relationship a circle is.
      //
      // Named `membersAction` because `members` is already taken by the
      // «{n} مستفيدة» count inside `SubjectCircles` — a label and an action are
      // different strings and the catalogue must not make one stand for both.
      membersAction: 'المستفيدات',
      membersTitle: 'مستفيدات الحلقة',
      membersCurrent: 'المسجّلات في هذه الحلقة',
      membersEmpty: 'لا مستفيدات في هذه الحلقة بعد.',
      addMember: 'إضافة مستفيدة إلى الحلقة',
      addMemberHint:
        'المعروضات هنا مسجّلات في مستوى الحلقة وبلا حلقة في هذه المادة. المستفيدة التي لها حلقة أخرى في المادة نفسها تُنقل بإخراجها من حلقتها أولًا — والحلقة مستقلة عن المجموعة الإدارية تمامًا.',
      noCandidates: 'كل المسجّلات في هذا المستوى لهن حلقة في هذه المادة.',
      memberAdded: 'أُسندت المستفيدة إلى الحلقة.',
      memberRemoved: 'أُخرجت المستفيدة من الحلقة.',
      // **الفرع والمؤطِّرة ليستا عمودين هنا، وهذا مقصود**: الحلقة لا تنتمي إلى
      // فرع (فالمستوى يمتد على الفروع)، والتأطير خصيصة جدول الحصص لا خصيصة
      // الحلقة. عمودٌ لأيّهما يخلط التنظيم بالتنفيذ.
      columnsNote:
        'الحلقة لا تنتمي إلى فرع بعينه — المستوى يمتد على الفروع، والإسناد يُقيَّد بفرع تسجيل المستفيدة. والتأطير يُحدَّد في جدول الحصص، لا في الحلقة.',
      backToCircles: 'كل الحلقات',
      circlesPickLevelFirst: 'اختاري المستوى أولًا',
      noLevels: 'لا توجد مستويات بعد.',
      noGroups: 'هذا المستوى غير مقسّم إلى مجموعات.',
      groupsElsewhere: 'تُدار المجموعات في',
      noSubjects: 'لا تُدرَّس في هذا المستوى أي مادة، فلا توجد مادة تُقسَّم إلى حلقات. أسندي مادة إلى المستوى أولًا.',
      assignSubjects: 'مواد المستوى',
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
      // **R90 — the planning appraisal's words.** One string per warning kind,
      // never composed from fragments: a sentence assembled at runtime is one
      // that ends up half translated. They describe the PROFILE and refuse
      // nothing — «لم تُسجَّل» is deliberately not «غير متاحة», because somebody
      // who has declared nothing is not somebody who is busy.
      warnSubject: 'المادة غير مذكورة في ملفها',
      warnCategory: 'الفئة غير مذكورة في ملفها',
      warnUnavailable: 'غير متاحة في هذا الوقت',
      warnNoAvailability: 'لم تُسجَّل أوقاتها بعد',
      warnConflict: 'لديها حصة متعارضة',
      warnIndeterminate: 'تعذّر تقدير التفرغ لهذا التكرار',
      warnNoProfile: 'لم تُسجَّل بيانات تخطيط',
      warnUnknown: 'ملاحظة على ملفها',
      // The marker on an option, so a concern is visible BEFORE the choice.
      warnMark: 'ملاحظة',
      warnMarkNoProfile: 'بلا ملف',
      // **R91 — staffing has periods now.** The words say *from* and *until*
      // rather than naming a database column, and a blank date is explained
      // rather than left to guess: «من بداية الحصة» is the commonest answer.
      staffing: 'المؤطّرات وفتراتهن',
      staffingHint:
        'كل سطر إسناد بمدّته. لتعويض مؤقّت: حدّي نهاية إسناد المؤطّرة الأولى، وأضيفي المؤطّرة البديلة بمدّة التعويض، ثم سطرًا جديدًا لعودة الأولى.',
      noStaffing: 'لم تُسنَد أي مؤطّرة بعد.',
      addStaffing: 'إضافة إسناد',
      staffMember: 'المؤطّرة',
      staffPosition: 'الصفة',
      positionTeacher: 'مؤطّرة مسؤولة',
      positionAssistant: 'مؤطّرة مساعدة',
      effectiveFrom: 'من تاريخ',
      effectiveUntil: 'إلى تاريخ',
      effectiveFromHint: 'اتركيه فارغًا ليبدأ الإسناد مع بداية الحصة.',
      effectiveUntilHint: 'اتركيه فارغًا ليستمر إلى نهاية الحصة.',
      // §6 — واحدة مسؤولة في التاريخ الواحد؛ والمساعدات بلا عدد.
      overlappingMain: 'لا يمكن أن تكون مؤطّرتان مسؤولتين في تواريخ متداخلة. عدّلي المدد.',
      overlappingAssignment: 'لهذه المؤطّرة إسنادان متداخلان في هذه الحصة. عدّلي المدد.',
      staffPeriodOutside: 'مدّة الإسناد خارج فترة الحصة كلّها.',
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
        'الموافقة تُدخل المستفيدة إلى المدرسة فعليًا: تُسنَد إلى مستوى ومجموعة في المعاملة نفسها. حساب مقبول بلا إسناد يعني شخصًا قُبل ثم فُقد.',
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
      // R81 — سُلّم النقاط وحدّ النجاح أُلغيا: النقطة القصوى صارت خاصية الامتحان
      // نفسه، ولا حدّ نجاح في هذه المرحلة. المفتاحان حُذفا من السجل ومن قاعدة
      // البيانات معًا حتى لا يبقى إعداد يوحي بميزة لم تعد موجودة.
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
    // §4.9 — «المحتوى مرجوع إليه، لا مملوك»: النشرة الواحدة تُرجع إليها كل حصة
    // تستعملها. هذا هو الشقّ الثاني من الجملة (2026-08-17).
    usedInSessions: 'الحصص التي تستعمل هذا المحتوى',
    previewDownloadOnly: 'هذا النوع من الملفات يُنزَّل ولا يُعرض داخل المنصة.',
    previewUnsupported: 'متصفحك لا يدعم تشغيل هذا الملف — يمكنك تنزيله.',
  },
} as const;

export type Catalog = typeof ar;
