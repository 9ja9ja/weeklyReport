-- CreateTable
CREATE TABLE "ScheduleReport" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleReport_year_weekNum_key" ON "ScheduleReport"("year", "weekNum");
