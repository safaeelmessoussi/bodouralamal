[Documentation](../README.md) › [Overview](README.md) › **Lesson follow-up plan**

# Lesson follow-up — «قناة المستوى» and «أسئلة الحصة» (planned, not built)

**Status:** a plan the Document Owner asked for on 2026-10-28 (R247), to build **once students and teachers can sign in**. Nothing on this page is built except §4's today-option, and only if the Owner chooses it. **Review this page with the Owner before building**: the facts below were true on 2026-10-28.

## 1. How it works today, outside the platform

Each Level has an assistant teacher (مؤطِّرة مساعدة) who runs two Telegram spaces for its students:

| Space | What happens there |
|---|---|
| **Channel** («قناة الوميض») | Recordings of each session (several parts per session) and the session's slides as images |
| **Group** («الوميض للأسئلة والمناقشة») | After each session, the assistant posts questions about it, mostly open ones. Students reply in the group. The assistant corrects what is wrong, then marks one reply as the reference (complete) answer or writes the correct answer herself |

## 2. What the platform already covers

| Telegram does | The platform has | Since |
|---|---|---|
| Recordings per session | Recordings attached to a session (`SessionContent`), played in «حسب السورة» one after another, resumed where stopped | R43, R223, R239 |
| Slides per session or per recording | A session's images, and a recording's own pages, shown beside what is heard | R247 |
| Who may see what | Per-item visibility: public, the Level's members (`private`), staff (`hidden`) | §4.9 |
| A test after a session | A quick test linked to a session (open text and choice questions), answered and graded privately | R136, R137 |
| «New post» alerts | In-app notifications (the bell) | R82 |

What is missing is the **group**: questions the whole Level answers, answers seen by classmates, the assistant's correction, and the reference answer kept with the lesson.

## 3. Plan once sign-in is open

**Who.** Students of Categories whose members hold their own login (R170 §6); their assistant and teacher (the session's staff, `SessionStaff`), and administrators. A child without a login does not take part (§7: a minor has no account).

### 3.1 «جديد مستواي» — the channel's alert

- A notification to the Level's members when a recording or pages are attached to one of its sessions, one per session per day (not one per file).
- «حسب السورة» marks what is new since the reader's last visit.

### 3.2 «أسئلة الحصة» — the group

| Step | Who | Platform |
|---|---|---|
| 1. Post the questions | Assistant or teacher | From the session's «مواد الحصة»: one or more questions, open or choice, in order. Saved as a draft, then published |
| 2. Be told | Students of the session's audience | Notification «أسئلة الحصة» with a link |
| 3. Answer | Each student | One answer per question, text (a voice answer is an Owner decision, D-c), editable until reviewed |
| 4. Correct | Assistant | A queue «إجابات بانتظار التصويب» per Level and session. Each answer is marked «صحيحة» or «تحتاج تصويبًا» with a short note |
| 5. The reference answer | Assistant | Mark one reply as «الإجابة المرجعية», or write the correct answer. One per question |
| 6. Be told | The student | «تم تصويب إجابتك» |
| 7. Keep it with the lesson | Everyone who may see the session's recordings | Under the session's recordings in «حسب السورة»: «أسئلة الحصة», each with «عرض الإجابة» (the reference answer). Someone who listens later still revises with them, which the Telegram group cannot offer |

**Data (sketch).**

| Table | Holds |
|---|---|
| `session_question` | `session_id`, `position`, `kind` (open · choice), `text`, options, `model_answer` (the assistant's own), `published_at`, soft delete, `version` |
| `session_answer` | `question_id`, `student_user_id` (unique together), `text`, `status` (pending · correct · needs_fix), `feedback`, `reviewed_by`/`reviewed_at`, `is_reference` (at most one per question: a partial unique index), soft delete |

**API (sketch).** `GET/POST /sessions/{id}/questions`, `PATCH/DELETE /session-questions/{id}`, `PUT /session-questions/{id}/answer` (the student's own; the route takes no student id), `GET /session-questions/{id}/answers` (staff; classmates per D-a), `POST /session-answers/{id}/review`, `GET /me/session-questions` (to answer), `GET /staff/session-answers` (to review). Each one is added to TD-3, OpenAPI and the route guard together.

**Rules that apply.** A student's answer is personal data: it goes in the [personal-data map](../development/personal-data-map.md), with a retention period and a Trash path (TD-5). Review actions are audited (TD-8). A person is shown by their public display name (§7). The words a student reads are gender-neutral (R219).

### 3.3 Improvements over Telegram

- **Who has not answered**: per session, the assistant sees who answered, who did not, and who still needs a correction. A Telegram group cannot show this.
- **Reminder**: after N days without an answer, one reminder.
- **Reuse**: copy last year's questions for the same session of the same Surah, then edit them.
- **Drafted questions**: proposed from the lesson's transcript (R241's transcripts), for the assistant to edit or discard. Nothing is published without her.
- **One place per Level**: recordings, pages, questions and answers sit side by side, where Telegram splits them across two spaces.

### 3.4 Owner decisions to take first

| # | Decision | Options |
|---|---|---|
| D-a | Who sees a student's answer | (i) classmates at once, as in Telegram · (ii) classmates once it is reviewed · (iii) only staff and its author. The reference answer is shown to all in every option |
| D-b | Names on classmates' answers | Public display name · «مستفيد(ة)» with no name |
| D-c | Voice answers | Text only · text or voice (an upload; R170 §3's warning applies) |
| D-d | Who posts questions | The session's staff · also the Level's responsible assistant for every session of the Level |
| D-e | After the year | Answers kept with the session · removed after N months (the reference answers stay) |
| D-f | Graded | No (a follow-up, not an exam) · counted as participation only |

## 4. Today, without student sign-in — the simple option

**Recommended: «أسئلة الحصة» read-only on «حسب السورة».** An administrator (who can sign in today) types each session's questions and, once the assistant has corrected them in Telegram, its reference answer. They show under the session's recordings with «عرض الإجابة». Students keep answering in the Telegram group as now, but every question and its corrected answer stays with the lesson, for revision and for whoever joins later.

- Small to build: the `session_question` table of §3.2 (question plus `model_answer`), a form in «مواد الحصة», and the display on the Surah page. No student data is stored, so it adds no personal data. §3 then adds `session_answer` beside it.
- **With no build at all:** attach the questions with their reference answers to the session as one PDF in «مواد الحصة». It shows with the session's materials, but cannot open answer by answer.

**Related:** [scope-and-roadmap](scope-and-roadmap.md) · [business-processes](business-processes.md) · [`TASKS.md`](../TASKS.md) (row D15)
