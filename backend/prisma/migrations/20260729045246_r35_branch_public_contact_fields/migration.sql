-- AlterTable
ALTER TABLE "branch" ADD COLUMN     "address" VARCHAR(300),
ADD COLUMN     "email" VARCHAR(254),
ADD COLUMN     "google_maps_url" VARCHAR(500),
ADD COLUMN     "opening_hours_ar" VARCHAR(500),
ADD COLUMN     "phone" VARCHAR(20);
