-- CreateEnum
CREATE TYPE "refresh_revoked_reason" AS ENUM ('logout', 'suspension', 'user_deleted', 'reuse_detected');

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "rotated_from_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" "refresh_revoked_reason",

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_rotated_from_id_key" ON "refresh_token"("rotated_from_id");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_revoked_at_idx" ON "refresh_token"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_token_session_id_revoked_at_idx" ON "refresh_token"("session_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_rotated_from_id_fkey" FOREIGN KEY ("rotated_from_id") REFERENCES "refresh_token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
