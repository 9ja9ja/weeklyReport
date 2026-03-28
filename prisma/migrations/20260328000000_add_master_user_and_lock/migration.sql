-- AlterTable: Add master user fields to User (safe: all have defaults, existing data preserved)
ALTER TABLE "User" ADD COLUMN "isMaster" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "password" TEXT NOT NULL DEFAULT 'NOT_SET';
ALTER TABLE "User" ADD COLUMN "mustChangePw" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: SummaryLock
CREATE TABLE "SummaryLock" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SummaryLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SummaryLock_year_weekNum_key" ON "SummaryLock"("year", "weekNum");

-- Set initial master user: 구자영
UPDATE "User" SET "isMaster" = true WHERE "name" = '구자영';
