-- R141 Owner-ratified exception to audit append-only immutability.
-- Stop old writers before applying; restart only the corrected release.
-- One atomic, idempotent UPDATE: preserve rows, attribution and structural
-- evidence, removing only rejection-reason fields on this exact event type.
-- The historical writer used reason; the explicit aliases are equivalent
-- rejection-reason keys, not a recursive/regex/value-based PII scrubber.
UPDATE "audit_log"
SET "detail" = "detail" - ARRAY[
  'reason', 'decisionReason', 'decision_reason', 'rejectionReason', 'rejection_reason'
]
WHERE "action_type" = 'selfmanaged.reject'
  AND jsonb_typeof("detail") = 'object'
  AND "detail" ?| ARRAY[
    'reason', 'decisionReason', 'decision_reason', 'rejectionReason', 'rejection_reason'
  ];
