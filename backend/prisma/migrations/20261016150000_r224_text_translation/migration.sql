-- R224 §4 (Owner, 2026-10-16) — the translations of the texts the platform
-- stores (names, titles), keyed by the Arabic text, one row per language.
CREATE TABLE "text_translation" (
    "source" TEXT NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "text" TEXT NOT NULL,
    "origin" VARCHAR(16) NOT NULL DEFAULT 'initial',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "text_translation_pkey" PRIMARY KEY ("locale", "source"),
    -- The languages the language menu offers, Arabic excepted (it is the source).
    CONSTRAINT "text_translation_locale_check" CHECK ("locale" IN ('en', 'fr', 'es', 'de', 'zgh', 'shi-Latn')),
    CONSTRAINT "text_translation_origin_check" CHECK ("origin" IN ('initial', 'manual', 'machine')),
    CONSTRAINT "text_translation_nonempty_check" CHECK (length("source") > 0 AND length("text") > 0)
);
