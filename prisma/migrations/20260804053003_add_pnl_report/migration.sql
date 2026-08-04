-- CreateTable
CREATE TABLE "PnlReport" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PnlReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlCategory" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "orderIdx" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "v1Label" TEXT NOT NULL DEFAULT '',
    "v2Label" TEXT NOT NULL DEFAULT '',
    "revenueV1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueV2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costV1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costV2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfitV1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfitV2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opProfitV1" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opProfitV2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PnlCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PnlReport_year_weekNum_key" ON "PnlReport"("year", "weekNum");

-- CreateIndex
CREATE INDEX "PnlCategory_reportId_idx" ON "PnlCategory"("reportId");

-- AddForeignKey
ALTER TABLE "PnlCategory" ADD CONSTRAINT "PnlCategory_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PnlReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
