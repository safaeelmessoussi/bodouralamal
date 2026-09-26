# TASKS — open items only

Rules: one row per open item; tick = delete the row (git + `docs/CHANGES.log` are the history).
Closed history to 2026-09-25: [`archive/TASKS-2026-07-27-to-09-25.md`](archive/TASKS-2026-07-27-to-09-25.md).
Production go-live: **on hold (Owner)** — no Production action, nothing ordered or paid.

## Owner decisions (blocking the row's item only)

| # | Decision | Where it is written up |
|---|---|---|
| D1 | First-year women's «حفظ القرآن» circle + registration form (items 1+4, 2026-09-23): option A/B/C, تفسير too?, re-file circles 1·2·3 on Staging? | https://claude.ai/artifact/XmG5Uy1Ldo8QxrQLGBLAA1 · SRS R172 §15 |
| D2 | TD-3 listing of `GET /admin/teaching-groups`, `GET /students/me/grades`; `/admin/level-surahs` in §14.1 | OpenAPI descriptions say «unlisted in TD-3's seed» |
| D3 | Expose `tracks_quran_progress` on `GET /admin/subjects`; `GET /quran-students` for a beneficiary: refuse vs empty | R73/R87 |
| D4 | «حالة النظام» position in الإدارة (appended last; hers to move) | R105 menu order |
| D5 | Honorific «الأستاذة» as an editable setting vs the constant | `lib/item-title.ts` (R172 §12) |
| D6 | Codex questions still open: exact storage-key wording; R111 3-day purge job (audit identity e-mail closed by R170 §18) | personal-data-audit A.4 |
| D8 | `business-rules.md` has two `### BR-20` headings (Global reach · Seeded-not-immutable) — which number is which? | reference/business-rules.md |
| D9 | «المحتوى التعليمي» grouped «per Surah» (item 8, 2026-09-25): content carries no Surah in the model (§4.9); add `EducationalContent ↔ Surah`? | R174 §3 |
| D7 | Menu/route: TD-3.7 route; backup-freshness + TLS-expiry alarms on «حالة النظام» need a host-side publisher (design choice) | R169 §11 |

## Temporary Production at `bodouralamal.com` (R175 — OVH, outside Morocco)

Ends when the Moroccan VPS exists: restore there, OVH returns to Staging, the sign-in button comes back, registration is announced.

| # | Item | Who |
|---|---|---|
| P1 | DNS + Google redirect URI/origin for the new domain | **done** (Owner, 2026-09-26) |
| P2 | Certificate (`bodouralamal.com`, `www`, `staging` during the transition), `server_name`, `PUBLIC_BASE_URL`, `STORAGE_BASE_URL` | **done** (R175 §4; expires 2026-12-25) |
| P3 | Production overlay **carrying the memory ceilings** (the production overlay has none; the 4 GB box depends on them) | **done** (R175 §4) |
| P4 | Backup schedule + first recovery point on the host — this tier holds the only copy of what is published | engineering — repository, password and `/etc/bodour-recovery.env` exist; **timers not installed, no recovery point yet** |
| P5 | Publish سياسة الخصوصية and شروط الاستعمال (version 1) with the association's contact filled in | **Owner** |
| P6 | Disk: upgrade the OVH range before recordings accumulate (OVH grows storage by range, not in place) | Owner, later |
| P7 | No Staging gate while this lasts: `develop` → CI → this host, pre-deploy dump is the rollback | standing |
| P8 | Detach the previous website from the domain at the registrar — it still answers in caches that visited it; anyone stuck opens `/clear-cache` once ([runbook](operations/runbooks.md#a-visitor-still-sees-the-previous-website), R175 §5) | **Owner** |
| P9 | Escrow the restic password off the VPS with a second custodian (`/root/bodour-recovery/restic-password`) — the repository is useless without it | **Owner** |

## Owner tasks — data and legal (not code)

| # | Task | Where |
|---|---|---|
| T1 | Record the real date of birth for the 9 Staging beneficiaries reading «غير مسجَّل» (3 on Localhost) | «المستخدمون» / «حسابي» (R169 §9) |
| T2 | Enter the current academic year's periods before approvals (`NO_CURRENT_ACADEMIC_PERIOD` otherwise) | الفترات الدراسية (R122) |
| T3 | CNDP declaration filing | `docs/compliance/cndp-filing-and-privacy-notice.md` |
| T4 | Launch-data entry with the coordinator: branches, rooms, groups, roster, Level Subjects, «مقرر الحفظ» | §15.1, R-5 |

## UAT on Staging — awaiting the Owner's own Google sign-in

| # | Try |
|---|---|
| U1 | «دخول الحصة» + one audio and one video recording through the real screens |
| U2 | «تعديل الحصة» (audience, Subject, Surah, staff in one save); schedule a class and an exam with no title and read the composed one; recording under «التسجيلات» |
| U3 | «إدارة التسجيلات» → mark a Level → certificate; as the مستفيدة «شهاداتي» → PDF; «تثبيت التطبيق» from a phone |
| U4 | Register with a second Google account ticking several roles → «البتّ في الصفات المطلوبة»; «طلب صفة إضافية» from «حسابي» |
| U5 | «القاعات» capacity → schedule in that room; class with Level/group/circle all «الكل»; delete + restore a حلقة from «سلة المحذوفات»; «مستويات أخرى ينتمي إليها» |
| U6 | R173/R174/R175 on her phone (sign-in offered nowhere; `/api/v1/auth/google` is the way in): hero, sign-in sheet, the bell beside the burger, «حلقات المواد» + dialog, «حفظي», «المحتوى التعليمي» with its filters |
| U7 | QA with a real dual-role (parent + staff) account: §4.3 follows the active role |

## Engineering owed (no Production host needed)

| # | Item | Size |
|---|---|---|
| E1 | BR-3 Admin consent-gate override with mandatory justification + audit (TD-8) — not built | M |
| E2 | TD-11a performance measurement: ceiling-scale fixture (§2.4) on a disposable stack + p95 runner (reads <300 ms, Quran write <100 ms, presign <150 ms) | L |
| E3 | Generated permission-matrix test; J1–J8 as automation on Staging; ≥80 % coverage threshold in CI (§19.2) | L |
| E4 | Harden `verify-public-reader.mjs` waits (flaked twice on the hosted runner) | S |
| E5 | Restate `verify-assessment-library.sh` against R136's source/occurrence split (stale, 24/31) | S |
| E6 | `verify-backup-restore.sh` into hosted CI; integration/backup stacks off ephemeral host ports (55438, 58083, 59005, 59006) | S |
| E7 | «حالة النظام»: backup freshness + certificate expiry via a host-published status file (blocked on D7) | M |
| E9 | `admin-modules.test.ts` «every ready module has a screen» failed once in a full run (dynamic import), passed alone and on re-run — make it order-independent | S |

## Launch gate (§18/§19 — when go-live is lifted)

| # | Gate |
|---|---|
| G1 | Host: ≥4 vCPU, 4 GB RAM; 7881/tcp + 7882/udp open (host + provider), inbound UDP unfiltered; `LIVEKIT_NODE_IP`; dedicated `LIVEKIT_API_SECRET`; second Moroccan location for offsite backups |
| G2 | §19.1 pipeline steps 1–10 on the production VPS; Let's Encrypt automation verified (R-8); Nginx rate limits verified live (TD-13) |
| G3 | §18 checklists green (Educational Model incl. SQL-level composite-FK rejection · Quran Progress · Exams & Grading · Content/Consent/Storage · Data/Admin/Audit · Platform/Deployment); §19.2 named regressions (VERSION_CONFLICT, capacity race, double approval, MinIO-down, worker-down) |
| G4 | UAT with the branch coordinator incl. the low-digital-literacy registration drill (R-1); R-9 upload failure rate measured, escalation recorded |
| G5 | Production launch; LAUNCH row in `CHANGES.log` |

## Post-MVP (SRS §10.1 — do not build without a task)

Weight-template grading engine · FR/EN catalogues · Committees · `/admin/audit` page · print exam layout · CSV import · multipart resumable uploads · local username/password auth.
