-- CreateTable
CREATE TABLE "rate_limit_counter" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bucket" VARCHAR(60) NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_counter_window_start_idx" ON "rate_limit_counter"("window_start");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_counter_user_id_bucket_window_start_key" ON "rate_limit_counter"("user_id", "bucket", "window_start");

-- AddForeignKey
ALTER TABLE "rate_limit_counter" ADD CONSTRAINT "rate_limit_counter_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
