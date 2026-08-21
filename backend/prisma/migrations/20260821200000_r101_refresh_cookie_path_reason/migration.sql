-- Revision 101 — identify the one-time invalidation of legacy narrow-path
-- refresh sessions honestly. Reusing `logout`, `suspension`, `user_deleted` or
-- `reuse_detected` would make the audit trail claim an event that did not
-- happen; NULL is reserved for mechanical rotation (R17).
ALTER TYPE "refresh_revoked_reason"
  ADD VALUE IF NOT EXISTS 'cookie_path_migration';
