[Documentation](../README.md) › [Compliance](personal-data-audit.md) › **CNDP filing packet and the Arabic privacy notice**

# CNDP filing packet and the Arabic privacy notice — DRAFT for the Owner's review

**Status:** drafted 2026-09-22 under SRS Revision 170 §13 (the Owner: *«do the CNDP filing and
supply the Arabic privacy notice text, and I'll recheck them»*). **Nothing has been filed and no
legal text has been activated.** Every fact below marked `VERIFIED` is read from the repository at
this date; every field marked `[OWNER INPUT]` or `[PROVIDER EVIDENCE]` is one only the Owner, the
association's signatory or the hosting provider can supply, and the packet cannot be submitted
until each is filled — **outside Git**, never in this file. The filing regime (declaration F211
versus prior authorization F112, the Article 12 exemption, F115, F118) remains a
`LEGAL/CNDP CONFIRMATION` per the [readiness audit](personal-data-audit.md#filing-regime-and-transfer-decision);
this document prepares the answers for whichever route the adviser confirms.

This page cites the audit and the [personal-data map](../development/personal-data-map.md)
rather than restating their reasoning; where a statement here and one there disagree, the
repository is the truth and this page is the defect.

---

## Part A — Answers for the CNDP declaration form (F211 structure)

The CNDP's normal declaration asks, in order, for the controller, the processing, the data, the
people, the recipients, the retention, the security measures, the rights procedure and any
transfer. The French below is what goes on the form; the Arabic notice in Part B says the same
things to the people concerned.

### A.1 Responsable du traitement

| Champ | Réponse |
|---|---|
| Dénomination | `[OWNER INPUT]` — exact registered name of the association (statutes) |
| Forme juridique | Association (loi du 15 novembre 1958) — `[OWNER INPUT]` confirm; registration récépissé number and date |
| Adresse du siège | `[OWNER INPUT]` |
| Représentant légal / signataire | `[OWNER INPUT]` — name, function, mandate evidence |
| Contact pour l'exercice des droits | `[OWNER INPUT]` — one e-mail address and one postal address (the same ones the Arabic notice prints) |
| Délégué / responsable de la conformité | `[OWNER INPUT]` if designated (F115, on the adviser's determination) |

### A.2 Le traitement

| Champ | Réponse (`VERIFIED`) |
|---|---|
| Dénomination du traitement | Plateforme de gestion d'un institut d'enseignement du Coran et des sciences islamiques (« بذور الأمل ») |
| Finalités | (1) inscription et admission des bénéficiaires, des tutrices/tuteurs, des enseignantes et du personnel ; (2) organisation pédagogique — inscriptions par niveau et par période, groupes, cercles, emploi du temps, présences, progression en mémorisation, évaluations et notes ; (3) mise à disposition de contenus pédagogiques (fichiers et enregistrements de cours, publics ou réservés) ; (4) cours à distance auto-hébergés ; (5) communication interne (notifications) ; (6) sécurité, traçabilité et exercice des droits |
| Base légale | Consentement de la personne (ou de la tutrice/du tuteur pour une mineure), recueilli à l'inscription avec une version horodatée du texte de consentement ; intérêt légitime de l'association pour la gestion administrative et la sécurité ; obligation légale pour la conservation des preuves de consentement et des journaux de sécurité |
| Caractère obligatoire des champs | Obligatoires : prénom et nom en arabe, sexe, téléphone (adultes), date de naissance (bénéficiaires), réponse explicite sur la diffusion de l'image/voix (enfants), catégorie et établissement demandés. Facultatifs : prénom et nom en français, surnom, niveau de scolarisation (enfants), préférences d'encadrement (enseignantes). Aucun autre champ n'est collecté |
| Décision automatisée | Aucune. Chaque admission, placement, note publiée et refus est une décision d'une personne habilitée |

### A.3 Données traitées (`VERIFIED` — the current schema; nothing else is collected)

| Catégorie | Données | Personnes |
|---|---|---|
| Identité | prénom et nom (arabe ; français facultatif), surnom facultatif, sexe, **date de naissance (bénéficiaires uniquement)**, code de référence non nominatif (`BA-…`, attribué automatiquement à chaque bénéficiaire, SRS R170 §7), identifiant QR non nominatif | toutes ; DOB : bénéficiaires |
| Contact | téléphone (adultes) ; adresse e-mail Google vérifiée (comptes disposant d'une connexion) | adultes |
| Vie scolaire | catégorie/niveau/établissement demandés puis attribués, inscriptions par période, groupe et cercle, présences, progression de mémorisation (sourates), évaluations, réponses et notes, attestation d'achèvement de niveau | bénéficiaires |
| Famille | lien tutrice/tuteur ↔ enfant, réponse de la tutrice/du tuteur sur la diffusion image/voix de l'enfant | tutrices/tuteurs, enfants |
| Encadrement | préférences d'encadrement (présentiel/à distance, établissements), disponibilités, affectations aux cours | enseignantes, personnel |
| Contenus et enregistrements | fichiers pédagogiques déposés par le personnel ; enregistrements de cours (voix de l'enseignante expliquant la leçon ; vidéo hors périmètre actuel) ; un signal interne « une bénéficiaire de l'audience n'a pas de consentement de diffusion » (avertissement au personnel, R170 §3) | enseignantes ; audience des cours |
| Sécurité et traçabilité | sessions de connexion, journal d'audit (qui a fait quoi, quand — identifiants structurels, jamais de texte libre nominatif), versions du texte de consentement acceptées, motifs de refus d'une demande (internes ; partagés avec la personne uniquement sur décision explicite de l'administration, R170 §11) | toutes |

**Données sensibles :** aucune donnée de santé, de situation familiale ou d'adresse du domicile
n'est collectée pour les mineurs (décision du 2026-09-21, R170 §12). Aucun document de tutelle
n'est demandé ni conservé. La participation à un enseignement coranique peut révéler des
convictions religieuses : `LEGAL/CNDP CONFIRMATION` sur la qualification (voir l'audit).

### A.4 Personnes concernées et destinataires

| Champ | Réponse (`VERIFIED`) |
|---|---|
| Personnes concernées | bénéficiaires adultes ; bénéficiaires mineures (représentées par une tutrice/un tuteur) ; tutrices/tuteurs ; enseignantes et assistantes ; personnel administratif ; visiteurs du site public (aucune donnée collectée hors journaux techniques) |
| Destinataires internes | le personnel habilité, **dans les limites de son établissement et de ses cours** (autorisations vérifiées côté serveur à chaque requête) ; la tutrice/le tuteur pour son enfant ; la personne pour ses propres données |
| Destinataires externes | aucun. Les contenus marqués « publics » sont accessibles à tout visiteur du site — c'est une diffusion décidée par le personnel, signalée au public de la notice |
| Sous-traitants | hébergeur : `[PROVIDER EVIDENCE]` (Hostoweb — dénomination exacte, adresse du centre de données au Maroc, sous-traitants ayant accès, conditions de sauvegarde et d'incident, par écrit) ; authentification : Google (connexion « Se connecter avec Google », périmètre `openid email` — `[OWNER INPUT]` entité et pays destinataires, à qualifier avec l'adviser pour F118) |
| Cours à distance et enregistrements | serveur média auto-hébergé sur la même infrastructure marocaine (LiveKit) ; **aucun** service média, cloud ou de stockage tiers (décision de l'Owner, SRS R164) |

### A.5 Durées de conservation (`VERIFIED` — chaque durée est un choix de l'association, écrit dans le code)

| Donnée | Durée | Source |
|---|---|---|
| Compte et dossier pédagogique | tant que le compte existe ; **7 jours** après suppression (par la personne ou l'administration), puis dé-identification définitive et destruction du dossier propre à la personne | R133 |
| Demande d'inscription refusée / jamais traitée | **12 mois** à compter du refus / du dépôt | §4.10a |
| Tout enregistrement supprimé (corbeille) | **7 jours**, puis destruction | R133 |
| Ancienne version d'un fichier remplacé | quarantaine, destruction automatique après **90 jours** | R170 §10 |
| Journaux d'authentification | **12 mois** | TD-8 / security handbook |
| Journal d'audit métier et preuves de consentement | conservés avec le dossier ; les preuves de consentement survivent à la suppression du compte | TD-8, R119 |
| Données partagées (cours, examens, contenus du personnel, dossiers d'autres personnes) | non supprimées par la suppression d'un compte | R133 (4) |
| Sauvegardes | chiffrées, **mensuelles, deux générations au plus** ; une suppression n'est pas répercutée dans une sauvegarde antérieure, qui expire à la rotation | R133 (6) |

### A.6 Mesures de sécurité (`VERIFIED`; details in the [security handbook](../architecture/security.md))

Authentification par Google avec liaison locale du compte ; jetons d'accès en mémoire, cookie de
rafraîchissement HttpOnly rotatif, révocation ; autorisations vérifiées côté serveur à chaque
requête et re-lues pour les opérations sensibles ; contenus réservés servis par URL signées de
courte durée ; objets publics servis uniquement après vérification en base de la ligne courante ;
journal d'audit sans texte libre nominatif ; hébergement et stockage objet au Maroc ; sauvegardes
chiffrées ; corbeille et purges bornées et journalisées ; page d'état pour l'administration.

### A.7 Droits des personnes (`VERIFIED` mechanism; contact `[OWNER INPUT]`)

Accès et rectification : « حسابي » pour ses propres données (téléphone, surnom, date de naissance
manquante) ; le reste par demande à l'adresse de contact. Opposition/retrait du consentement de
diffusion : à tout moment, auprès du personnel (enregistré comme une nouvelle décision datée).
Suppression : « حذف حسابي » (7 jours de rétractation). Portabilité : sur demande. Réponse dans
`[OWNER INPUT]` jours.

### A.8 Transfert hors du Maroc

Hébergement, base de données, stockage et média : Maroc (`[PROVIDER EVIDENCE]`). Seule
l'authentification transite par Google : `[OWNER INPUT]` + `LEGAL/CNDP CONFIRMATION` (F118 si
requis). Aucun autre flux sortant.

---

## Part B — The Arabic privacy notice (text for `/privacy`)

**To be reviewed, completed where `[…]` appears, and activated by the Owner as a `LegalDocument`
of kind `privacy` (SRS R138) — never installed by an engineering task.** It states only what the
platform does today. Sections marked ◆ change with Revision 170 and did not exist in earlier
drafts.

> # سياسة الخصوصية وحماية المعطيات الشخصية
>
> **الجهة المسؤولة عن المعالجة:** جمعية [الاسم القانوني الكامل للجمعية]، الكائن مقرها بـ[العنوان]، المصرَّح بها تحت رقم [رقم الوصل]. للتواصل في كل ما يخص معطياتكم الشخصية: [البريد الإلكتروني] — [العنوان البريدي].
>
> تخضع هذه المعالجة للقانون رقم 09-08 المتعلق بحماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي. [تم التصريح بها لدى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي تحت رقم … بتاريخ …].
>
> ## 1. لماذا نعالج معطياتكم
>
> نستعمل معطياتكم لأغراض محدَّدة لا غير: تسجيلكم وقبولكم في الجمعية (مستفيدةً أو وليّ أمر أو مؤطِّرة أو عضوًا في الإدارة)؛ تنظيم الدراسة (التسجيل في المستويات والفصول، المجموعات والحلقات، الجداول الزمنية، الحضور، تتبّع الحفظ، الاختبارات والنقاط، شهادات إتمام المستوى)؛ إتاحة المحتوى التعليمي وتسجيلات الحصص؛ الحصص عن بُعد؛ التبليغ الداخلي؛ وأمن المنصة وإثبات العمليات وتمكينكم من حقوقكم.
>
> لا تتخذ المنصة أي قرار آليّ في شأنكم: كل قبول أو رفض أو تعيين أو نقطة منشورة قرارٌ تتخذه شخصٌ مؤهَّلة من الجمعية.
>
> ## 2. ما الذي نجمعه
>
> **عند التسجيل، إلزامي:** الاسم الشخصي والعائلي بالعربية، الجنس، رقم الهاتف (للراشدين)، **تاريخ الازدياد الكامل للمستفيدة أو المستفيد** (يُستعمل لتحديد بلوغ سن الرشد وما يترتب عنه على تدبير الحساب، ولا يُستعمل لقبول أو رفض إدراج في فئة أو مستوى)، المقر والفئة المطلوبان، وبالنسبة إلى كل طفل قرارٌ صريح من وليّ الأمر بشأن نشر صوته أو صورته.
>
> **اختياري:** الاسم بالفرنسية، الكنية (تُستعمل داخليًّا للبحث فقط)، المرحلة الدراسية للطفل (تُفيد في التوجيه ولا تحسم فيه)، وتفضيلات التأطير للمؤطِّرات.
>
> **لا نجمع** أي معطيات صحية ولا عن الوضعية العائلية ولا عنوان السكن للقاصرين، ولا نطلب أي وثيقة تثبت الولاية.
>
> **يُنشأ تلقائيًّا:** ◆ رمز مرجعي قصير غير اسمي لكل مستفيدة ومستفيد (مثل `BA-7K4M2`) يُقال شفويًّا بدل الاسم، ورمز QR غير اسمي؛ لا يمنح أيٌّ منهما أي صلاحية.
>
> **عند الاستعمال:** بريدكم الإلكتروني الذي يُتحقَّق منه عبر حساب Google عند الدخول، وسجلات الدخول والعمليات (من فعل ماذا ومتى، بمعرِّفات لا بنصوص حرة)، ومعطياتكم الدراسية التي يسجلها الطاقم (الحضور، الحفظ، النقاط).
>
> ## 3. من يطّلع على معطياتكم
>
> طاقم الجمعية المؤهَّل، **في حدود مقرّه وحصصه فقط**، ويُتحقَّق من ذلك على الخادم عند كل طلب. وليّ الأمر يطّلع على معطيات ابنه أو ابنته. وأنتم تطّلعون على معطياتكم في «حسابي».
>
> **لا نُسلِّم معطياتكم لأي طرف خارجي.** ما يقرر الطاقم نشره «عامًّا» من محتوى تعليمي يكون متاحًا لزوار الموقع؛ وهو نشرٌ يقرره الطاقم لا آليّ.
>
> **مقدّمو الخدمات:** تُستضاف المنصة وقاعدة معطياتها وملفاتها وخادم الحصص عن بُعد لدى [اسم المستضيف] في مراكز معطيات بالمغرب. لا نستعمل أي خدمة سحابية أو خدمة تخزين أو بثّ أجنبية لمعطياتكم أو تسجيلاتكم. تسجيل الدخول يتم عبر Google ولا يطلب منه سوى هويتكم وبريدكم الإلكتروني (`openid email`)؛ [بيان هوية Google المتلقّية وبلدها ووضع النقل].
>
> ## 4. تسجيلات الحصص ونشر الصوت والصورة
>
> قد تسجل المؤطِّرة صوتها وهي تشرح الدرس، وقد يُسجَّل درس عن بُعد. يُعلَن التسجيل أثناء الحصة («جارٍ التسجيل») ولا يُسجَّل أحد خفيةً. تُحدَّد درجة ظهور كل تسجيل (عام / خاص بمستفيدات المستوى / مخفي) من طرف الطاقم، انطلاقًا من الإعداد الافتراضي للفئة.
>
> ◆ **إذا رفض وليّ أمرٍ نشر صوت ابنه أو ابنته أو صورته، يُنبَّه الطاقم إلى ذلك قبل التسجيل وعند اختيار درجة الظهور**، ويعود إليه قرار جعل التسجيل خاصًّا. ويمكنكم في أي وقت تغيير قراركم بشأن النشر بإبلاغ الطاقم، ويُسجَّل قرارُكم الجديد بتاريخه.
>
> ## 5. كم نحتفظ بمعطياتكم
>
> المدد التالية سياسةٌ اعتمدتها الجمعية:
>
> - **حسابكم وملفكم الدراسي:** ما دام الحساب قائمًا. عند حذفه يبقى قابلًا للاسترجاع عبر الإدارة مدة **سبعة (7) أيام**، ثم يُحذف نهائيًّا هو ومعطياتكم التعليمية الخاصة بكم. وقد يتعذّر بعدها إثبات المستوى الذي وصلتم إليه أو إصدار شهادة لكم.
> - **طلب التسجيل المرفوض أو الذي لم يُبتّ فيه:** **اثنا عشر (12) شهرًا** من تاريخ الرفض أو الإيداع.
> - **كل ما يُحذف من سجلات (سلة المحذوفات):** سبعة (7) أيام ثم يُحذف نهائيًّا.
> - ◆ **النسخة القديمة من ملف استُبدل:** تُحفظ معزولةً ثم تُتلف تلقائيًّا بعد **تسعين (90) يومًا**.
> - **سجلات الدخول:** اثنا عشر (12) شهرًا. **سجلات العمليات وأدلة الموافقة:** تُحفظ مع الملف، وتبقى أدلة الموافقة بعد حذف الحساب لأنها إثبات لما وافقتم عليه.
> - **ما لا يخصكم وحدكم** — الحصص والاختبارات والمحتوى التعليمي وسجلات الأشخاص الآخرين — لا يُحذف بحذف حسابكم.
> - **النسخ الاحتياطية:** مشفَّرة، **شهرية، بنسختين على الأكثر**. الحذف لا يُطبَّق على نسخة احتياطية سابقة، فقد تبقى معطياتكم فيها إلى أن يحين دورها في الحذف (شهران على الأكثر في الأحوال العادية).
>
> ## 6. حقوقكم
>
> - **الاطلاع والتصحيح:** من «حسابي» (الهاتف، الكنية، تاريخ الازدياد إن لم يُسجَّل بعد)؛ وما عدا ذلك بطلب إلى عنوان التواصل أعلاه.
> - **الاعتراض وسحب الموافقة على النشر:** في أي وقت، بإبلاغ الطاقم.
> - **حذف الحساب:** من «حسابي» → «حذف حسابي». ينقطع الدخول فورًا، ويمكن الرجوع عن الحذف عبر الإدارة خلال سبعة أيام.
> - ◆ **معرفة سبب رفض طلبكم:** تُبلَّغون بالرفض دائمًا، وقد تختار الإدارة إبلاغكم بسببه؛ ويظهر لكم حينئذٍ في «حسابي».
> - **الشكاية:** لدى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (CNDP).
>
> نرد على طلباتكم خلال [عدد] يومًا.
>
> ## 7. القاصرون
>
> لا يحمل القاصر حسابًا خاصًّا به؛ يُسجِّله وليّ أمره ويدبّر حسابه ويقرر بشأن نشر صوته وصورته. وعند بلوغ المستفيدة أو المستفيد سن الثامنة عشرة يمكنه أن يطلب تدبير حسابه بنفسه، ويصبح ذلك نافذًا بعد مصادقة الإدارة، وتنتهي حينئذٍ صلاحية وليّ الأمر ولا تُستعاد. ولا يتم هذا الانتقال تلقائيًّا.
>
> ## 8. ملفات تعريف الارتباط
>
> لا تستعمل المنصة ملفات تتبّع أو إعلانات. تُستعمل ملفات تعريف ارتباط ضرورية لتسجيل الدخول فقط (جلسة الدخول وحمايتها)، وهي لا تُقرأ لأي غرض آخر.
>
> ## 9. تغيير هذه السياسة
>
> لكل إصدار من هذه السياسة تاريخ سريان، ويبقى الإصدار الذي وافقتم عليه محفوظًا كما قرأتموه. عند تغييرها يُنشر الإصدار الجديد هنا بتاريخه.
>
> **الإصدار:** [التاريخ] — [رقم الإصدار].

### What is deliberately NOT in the notice

- No claim of CNDP approval, number or date until one exists — the bracket stays a bracket.
- No promise of erasure from backups faster than the rotation allows (R133 (6)).
- No sentence implying the consent gate forces privacy — R170 §3 made it a warning, and a notice
  that said otherwise would misdescribe what the platform does.
- No collection it does not perform (health, family situation, home address, guardianship
  documents — R170 §12).

---

## Part C — What remains, in one list

1. `[OWNER INPUT]` — A.1 (controller, signatory, contact), A.7's response delay, the notice's
   bracketed fields.
2. `[PROVIDER EVIDENCE]` — Hostoweb's written confirmation for A.4/A.8.
3. `LEGAL/CNDP CONFIRMATION` — F211 vs F112, Article 12 exemption, F115, F118 (Google), the
   qualification of Quran-progress data. The adviser reads Part A as prepared answers.
4. The Owner activates Part B as the `privacy` `LegalDocument` (and reconciles the registration
   `LegalConsentText` with the [draft paragraphs](../development/personal-data-map.md#the-draft-paragraphs)),
   then verifies anonymous rendering at `/privacy` on Staging.
5. Only then: assemble the packet privately and file. This task filed nothing.
