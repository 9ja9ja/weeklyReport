-- CreateTable
CREATE TABLE "BriefDoc" (
    "id" SERIAL NOT NULL,
    "environment" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "ydoc" BYTEA NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "docGeneration" INTEGER NOT NULL DEFAULT 1,
    "writeEpoch" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "seedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BriefDoc_environment_year_weekNum_key" ON "BriefDoc"("environment", "year", "weekNum");
