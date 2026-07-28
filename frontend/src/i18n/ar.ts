export const ar = {
  // Common
  common: {
    appName: "بذور الأمل",
    loading: "جاري التحميل...",
    error: "حدث خطأ",
    success: "تم بنجاح",
    cancel: "إلغاء",
    confirm: "تأكيد",
    save: "حفظ",
    delete: "حذف",
    edit: "تعديل",
    back: "عودة",
    close: "إغلاق",
    submit: "إرسال",
    next: "التالي",
    previous: "السابق",
    logout: "تسجيل الخروج",
    home: "الرئيسية",
    dashboard: "لوحة التحكم",
  },

  // Landing Page
  landing: {
    heroTitle: "مرحبا بكم في بذور الأمل",
    heroSubtitle: "منصة تعليمية متكاملة لحفظ القرآن والدراسات الإسلامية ومحو الأمية",
    heroDescription: "نحن نوفر بيئة تعليمية داعمة للطلاب والمعلمات والأهالي في رحلة التعليم الديني والأساسي",
    
    featuresTitle: "خدماتنا",
    featureQuran: {
      title: "حفظ القرآن الكريم",
      description: "برامج منظمة لحفظ القرآن الكريم مع المتابعة المستمرة والتقييم الدوري",
    },
    featureIslamic: {
      title: "الدراسات الإسلامية",
      description: "تعليم العقيدة والفقه والسيرة النبوية بطرق حديثة وشيقة",
    },
    featureLiteracy: {
      title: "محو الأمية",
      description: "برامج متخصصة لمحو الأمية وتعليم القراءة والكتابة للبالغين",
    },
    featureTracking: {
      title: "متابعة الأداء",
      description: "نظام شامل لمتابعة تقدم الطلاب والحصول على التقارير التفصيلية",
    },

    registrationTitle: "انضم إلينا",
    registrationSubtitle: "سجل معنا الآن وابدأ رحلتك التعليمية",
    registerButton: "سجل الآن",

    contactTitle: "تواصل معنا",
    contactDescription: "هل لديك أي أسئلة؟ نحن هنا لمساعدتك",
    contactEmail: "البريد الإلكتروني: contact@bodour.ma",
    contactPhone: "الهاتف: +212 5XX XXX XXX",
  },

  // Login Page
  login: {
    title: "تسجيل الدخول",
    subtitle: "مرحبا بك في بذور الأمل",
    description: "استخدم حسابك في جوجل للدخول إلى المنصة",
    googleSignIn: "تسجيل الدخول عبر جوجل",
    signingIn: "جاري تسجيل الدخول...",
    noAccount: "لا تملك حساباً؟",
    signUpFlow: "قم بتسجيل الدخول عبر جوجل أولاً، ثم ستتمكن من إكمال بيانات التسجيل",
    privacyNote: "نحن لا نخزن كلمة المرور. نستخدم فقط بريدك الإلكتروني من جوجل للتحقق",
    error: {
      userDenied: "لقد رفضت تسجيل الدخول عبر جوجل",
      stateMismatch: "حدث خطأ في المصادقة، يرجى المحاولة مجددا",
      accountDeactivated: "حسابك معطل حالياً",
    },
  },

  // Registration Page
  registration: {
    title: "إكمال التسجيل",
    subtitle: "يرجى إكمال بيانات ملفك الشخصي",
    
    fields: {
      firstName: "الاسم الشخصي",
      lastName: "الاسم العائلي",
      email: "البريد الإلكتروني",
      gender: "الجنس",
      maleLabel: "ذكر",
      femaleLabel: "أنثى",
      category: "الفئة",
      categoryChild: "الطفل",
      categoryYouth: "اليافعات",
      categoryWoman: "المرأة",
    },

    parentInfo: {
      title: "بيانات ولي الأمر",
      parentName: "اسم ولي الأمر",
      parentPhone: "هاتف ولي الأمر",
      parentEmail: "بريد ولي الأمر الإلكتروني",
    },

    adultInfo: {
      title: "معلومات إضافية",
      phone: "رقم الهاتف",
      occupation: "المهنة",
    },

    placeholders: {
      firstName: "أدخل اسمك الشخصي",
      lastName: "أدخل اسمك العائلي",
      phone: "أدخل رقم هاتفك",
      occupation: "أدخل مهنتك",
    },

    validation: {
      firstNameRequired: "الاسم الشخصي مطلوب",
      lastNameRequired: "الاسم العائلي مطلوب",
      genderRequired: "الجنس مطلوب",
      categoryRequired: "الفئة مطلوبة",
      phoneRequired: "رقم الهاتف مطلوب",
      invalidPhone: "رقم الهاتف غير صحيح",
    },

    buttons: {
      submit: "إرسال الطلب",
      submitting: "جاري الإرسال...",
    },

    errors: {
      registrationFailed: "فشل التسجيل. يرجى المحاولة مجددا",
      invalidToken: "رمز التفعيل غير صحيح",
      tokenExpired: "انتهت صلاحية رمز التفعيل",
    },
  },

  // Pending Approval Page
  pendingApproval: {
    title: "طلبك قيد المراجعة",
    subtitle: "شكراً لتسجيلك لدينا",
    message: "تم استقبال طلب التسجيل الخاص بك بنجاح. سيتم مراجعة بيانات ملفك والتحقق منها من قبل فريقنا.",
    nextSteps: "الخطوات القادمة:",
    step1: "سيتواصل معك فريقنا عبر البريد الإلكتروني أو الهاتف للتحقق من البيانات",
    step2: "بعد الموافقة، ستتمكن من الدخول الكامل للمنصة",
    step3: "يمكنك تسجيل الدخول مجددا بعد انتهاء المراجعة",
    waitMessage: "يرجى الانتظار قليلا...",
    contactSupport: "إذا كان لديك أي استفسارات، يرجى التواصل معنا",
    logout: "تسجيل الخروج",
  },

  // Admin Pages
  admin: {
    dashboard: {
      title: "لوحة التحكم",
      totalBranches: "إجمالي الفروع",
      totalUsers: "إجمالي المستخدمين",
      totalGroups: "إجمالي المجموعات",
      activeBranches: "الفروع النشطة",
    },
    users: {
      title: "إدارة المستخدمين",
      name: "الاسم",
      email: "البريد الإلكتروني",
      role: "الدور",
      status: "الحالة",
      lastLogin: "آخر دخول",
      delete: "حذف",
    },
    branches: {
      title: "إدارة الفروع",
      name: "اسم الفرع",
      location: "الموقع",
      manager: "مدير الفرع",
      active: "نشط",
      inactive: "غير نشط",
    },
    groups: {
      title: "إدارة المجموعات",
      name: "اسم المجموعة",
      type: "النوع",
      teacher: "المعلمة",
      students: "عدد الطلاب",
      capacity: "السعة",
    },
    calendar: {
      title: "التقويم",
      events: "الفعاليات",
    },
    content: {
      title: "مكتبة المحتوى",
      name: "العنوان",
      type: "النوع",
    },
    approvals: {
      title: "قائمة الموافقات",
      pending: "قيد الانتظار",
      approve: "موافقة",
      reject: "رفض",
    },
    settings: {
      title: "الإعدادات",
      general: "عام",
      security: "الأمان",
    },
  },

  // Student Pages
  student: {
    dashboard: {
      title: "لوحة تحكم الطالب",
      myGrade: "درجتي",
      surahsCompleted: "السور المكتملة",
      attendance: "الحضور",
      nextClass: "الحصة القادمة",
      currentAverage: "المعدل الحالي",
      of: "من",
      thisMonth: "هذا الشهر",
      thisTerm: "هذا الفصل",
      today: "اليوم",
      upcomingTasks: "المهام القادمة",
      myClasses: "فصولي",
      due: "الموعد النهائي",
      priority: "الأولوية",
      high: "عالية",
      medium: "متوسطة",
      low: "منخفضة",
      surahReview: "مراجعة السورة",
      islamicStudiesQuiz: "اختبار الدراسات الإسلامية",
      tajweedAssignment: "واجب التجويد",
      viewDetails: "عرض التفاصيل",
    },
  },

  // Parent Pages
  parent: {
    dashboard: {
      title: "لوحة تحكم ولي الأمر",
      childGrade: "درجة الطفل",
      childSurahsCompleted: "السور المكتملة للطفل",
      childAttendance: "حضور الطفل",
      nextChildClass: "الحصة القادمة للطفل",
      myChildren: "أطفالي",
      childName: "اسم الطفل",
      addChild: "إضافة طفل",
      viewProgress: "عرض التقدم",
      viewAttendance: "عرض الحضور",
    },
  },

  // Teacher Pages
  teacher: {
    dashboard: {
      title: "لوحة تحكم المعلمة",
      myGroups: "مجموعاتي",
      myStudents: "طلابي",
      upcomingSessions: "الجلسات القادمة",
      totalStudents: "إجمالي الطلاب",
      groupName: "اسم المجموعة",
      lastSession: "آخر جلسة",
      nextSession: "الجلسة القادمة",
      sessionTime: "وقت الجلسة",
    },
    groups: {
      title: "المجموعات",
      groupName: "اسم المجموعة",
      students: "الطلاب",
      manage: "إدارة",
      addGroup: "إضافة مجموعة",
      editGroup: "تعديل المجموعة",
    },
    quran: {
      title: "متابعة حفظ القرآن",
      studentName: "اسم الطالب",
      chapter: "السورة",
      progress: "التقدم",
      startingPoint: "نقطة البداية",
      endingPoint: "نقطة النهاية",
      qualityScore: "درجة الجودة",
      addEntry: "إضافة إدخال",
      editEntry: "تعديل الإدخال",
    },
    exams: {
      title: "الامتحانات",
      examName: "اسم الامتحان",
      date: "التاريخ",
      grade: "التقدير",
      score: "الدرجة",
      maxScore: "أقصى درجة",
      passed: "نجح",
      failed: "رسب",
      createExam: "إنشاء امتحان",
      editExam: "تعديل الامتحان",
      gradeExam: "تصحيح الامتحان",
    },
    content: {
      title: "المحتوى التعليمي",
      uploadContent: "تحميل محتوى",
      contentName: "اسم المحتوى",
      contentType: "نوع المحتوى",
      fileSize: "حجم الملف",
      uploadedDate: "تاريخ التحميل",
      addContent: "إضافة محتوى",
      editContent: "تعديل المحتوى",
      deleteContent: "حذف المحتوى",
    },
  },

  // Roles
  roles: {
    admin: "مدير النظام",
    branchManager: "مدير الفرع",
    teacher: "معلمة",
    parent: "ولي أمر",
    student: "طالب",
  },

  // Status
  status: {
    active: "نشط",
    inactive: "غير نشط",
    pending: "قيد الانتظار",
    approved: "موافق عليه",
    rejected: "مرفوض",
    deleted: "محذوف",
  },
};
