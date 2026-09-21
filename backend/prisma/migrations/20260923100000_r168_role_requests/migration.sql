-- SRS Revision 168 §1 — one registration form, four roles, each decided
-- separately (Document Owner, 2026-09-21).
--
-- A registration used to have ONE `kind` and the account was approved or
-- rejected as a whole. A person may now ask for any combination of four things
-- at once, and a Super Admin decides each on its own:
--
--   student         «أسجّل نفسي كمستفيدة»
--   guardian        «أسجّل أبنائي»                (the children stay one
--                                                  `child_application` each, R62)
--   teaching        «هيئة التدريس والمساعدة في التدريس»   → role `teacher`
--   administration  «هيئة الإدارة والمساعدة في الإدارة»   → `admin` or
--                   `super_admin`, WHICH being the approver's decision
--
-- **A row here is a request and never an authority.** Authority is
-- `user_branch_role`, written only by an audited approval. `user.requested_role`
-- (R49) stays as provenance on rows written before this revision and as the
-- teaching hint older readers expect; nothing new depends on it.
--
-- The account becomes `active` with the FIRST approved request and `rejected`
-- only when every request has been declined.

CREATE TYPE "role_request_kind" AS ENUM ('student', 'guardian', 'teaching', 'administration');
CREATE TYPE "role_request_status" AS ENUM ('pending', 'approved', 'declined');

CREATE TABLE "role_request" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL,
  "kind"           "role_request_kind" NOT NULL,
  "status"         "role_request_status" NOT NULL DEFAULT 'pending',
  -- «هل هذه أول مرة تلتحقين فيها؟» — asked of a مستفيدة only. NULL on rows
  -- back-filled below: nobody was asked, and no answer is invented.
  "first_time"     BOOLEAN,
  "decided_by"     UUID,
  "decided_at"     TIMESTAMPTZ(6),
  -- Operator-facing, never rendered raw to the applicant (TD-3.8's discipline).
  "decline_reason" VARCHAR(500),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "role_request_pkey" PRIMARY KEY ("id"),
  -- A request belongs to the person who made it and means nothing without her.
  -- The platform never hard-deletes a person (it de-identifies, and clears these
  -- rows explicitly when it does); CASCADE is for the rows' own coherence.
  CONSTRAINT "role_request_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_request_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "role_request_first_time_check"
    CHECK ("first_time" IS NULL OR "kind" = 'student'),
  -- Decided means: at a moment. Pending means not yet, by nobody. (WHO decided
  -- is always written by the service and is in the audit log; the column may
  -- only become NULL later, if that person's row ever ceases to exist.)
  CONSTRAINT "role_request_decision_check"
    CHECK (
      ("status" = 'pending' AND "decided_at" IS NULL AND "decided_by" IS NULL)
      OR ("status" <> 'pending' AND "decided_at" IS NOT NULL)
    ),
  CONSTRAINT "role_request_decline_reason_check"
    CHECK ("decline_reason" IS NULL OR "status" = 'declined')
);

-- One request per role per person. When asking again for a declined role is
-- built, it re-opens this row — never a second one — so the history of one
-- person and one role stays one line.
CREATE UNIQUE INDEX "role_request_user_kind_key" ON "role_request" ("user_id", "kind");
CREATE INDEX "role_request_pending_idx" ON "role_request" ("user_id") WHERE "status" = 'pending';

-- The memorisation circles a FIRST-TIME مستفيدة can attend, most convenient
-- first. A wish, never a seat: the approver still places her. The circles on
-- offer are the scheduled memorisation classes of her Category's first Level at
-- the branch she asked for — read from the schedule, never typed into a form.
CREATE TABLE "circle_preference" (
  "user_id"           UUID NOT NULL,
  "teaching_group_id" UUID NOT NULL,
  "rank"              SMALLINT NOT NULL,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "circle_preference_pkey" PRIMARY KEY ("user_id", "teaching_group_id"),
  CONSTRAINT "circle_preference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "circle_preference_teaching_group_id_fkey"
    FOREIGN KEY ("teaching_group_id") REFERENCES "teaching_group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "circle_preference_rank_check" CHECK ("rank" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "circle_preference_user_rank_key" ON "circle_preference" ("user_id", "rank");

-- Every registration still waiting for a decision gets the request(s) it
-- already is, so the approvals screen reads one model. Derived from facts that
-- exist: a staff request (R49), pending child applications (R62), otherwise a
-- مستفيدة registering herself. Decided accounts are left alone — what they were
-- asked for is history, and their audit rows hold it.
INSERT INTO "role_request" ("user_id", "kind")
SELECT u."id", 'teaching'
  FROM "user" u
 WHERE u."account_status" = 'pending' AND u."deleted_at" IS NULL
   AND u."requested_role" = 'teacher';

INSERT INTO "role_request" ("user_id", "kind")
SELECT DISTINCT u."id", 'guardian'::"role_request_kind"
  FROM "user" u
  JOIN "child_application" a ON a."parent_id" = u."id" AND a."status" = 'pending' AND a."deleted_at" IS NULL
 WHERE u."account_status" = 'pending' AND u."deleted_at" IS NULL;

INSERT INTO "role_request" ("user_id", "kind")
SELECT u."id", 'student'
  FROM "user" u
 WHERE u."account_status" = 'pending' AND u."deleted_at" IS NULL
   AND u."requested_role" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "role_request" r WHERE r."user_id" = u."id")
   -- A login-less child account (R62) is never an applicant.
   AND NOT EXISTS (SELECT 1 FROM "family_link" f WHERE f."student_id" = u."id");
