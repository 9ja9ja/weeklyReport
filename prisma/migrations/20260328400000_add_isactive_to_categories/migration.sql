-- Add isActive field to MajorCategory and Category (default true, existing data preserved)
ALTER TABLE "MajorCategory" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
