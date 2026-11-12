-- R266 — the مؤطِّرة ends an online class for everyone; nobody enters after.
ALTER TABLE "session" ADD COLUMN "online_ended_at" TIMESTAMPTZ(6);
