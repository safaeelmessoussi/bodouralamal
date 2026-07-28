-- CreateEnum
CREATE TYPE "hijri_month_status" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "hijri_month_start" (
    "id" UUID NOT NULL,
    "hijri_year" INTEGER NOT NULL,
    "hijri_month" INTEGER NOT NULL,
    "gregorian_start_date" DATE NOT NULL,
    "status" "hijri_month_status" NOT NULL DEFAULT 'draft',
    "source" VARCHAR(80) NOT NULL DEFAULT 'manual',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "hijri_month_start_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hijri_month_start_gregorian_start_date_idx" ON "hijri_month_start"("gregorian_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "hijri_month_start_hijri_year_hijri_month_key" ON "hijri_month_start"("hijri_year", "hijri_month");
