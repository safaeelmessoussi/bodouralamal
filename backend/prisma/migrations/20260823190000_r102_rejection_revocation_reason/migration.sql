-- Revision 102: Pending -> Rejected is a deliberate account-wide session
-- revocation. Keep its attribution distinct from suspension and deletion.
ALTER TYPE "refresh_revoked_reason" ADD VALUE 'rejection';
