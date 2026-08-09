-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "collabFromWeek" INTEGER,
ADD COLUMN     "collabFromYear" INTEGER;

-- CreateTable
CREATE TABLE "SharedDoc" (
    "id" SERIAL NOT NULL,
    "environment" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "ydoc" BYTEA NOT NULL,
    "contents" TEXT NOT NULL DEFAULT '{}',
    "docGeneration" INTEGER NOT NULL DEFAULT 1,
    "writeEpoch" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "seedId" TEXT NOT NULL,
    "seededFrom" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedDocSnapshot" (
    "id" SERIAL NOT NULL,
    "docId" INTEGER NOT NULL,
    "ydoc" BYTEA NOT NULL,
    "docGeneration" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedDocSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocActivity" (
    "id" SERIAL NOT NULL,
    "environment" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastEditedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersistReceipt" (
    "requestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersistReceipt_pkey" PRIMARY KEY ("requestId")
);

-- CreateIndex
CREATE INDEX "SharedDoc_year_weekNum_idx" ON "SharedDoc"("year", "weekNum");

-- CreateIndex
CREATE UNIQUE INDEX "SharedDoc_environment_teamId_year_weekNum_key" ON "SharedDoc"("environment", "teamId", "year", "weekNum");

-- CreateIndex
CREATE INDEX "SharedDocSnapshot_docId_createdAt_idx" ON "SharedDocSnapshot"("docId", "createdAt");

-- CreateIndex
CREATE INDEX "DocActivity_environment_teamId_year_weekNum_idx" ON "DocActivity"("environment", "teamId", "year", "weekNum");

-- CreateIndex
CREATE UNIQUE INDEX "DocActivity_environment_teamId_year_weekNum_userId_key" ON "DocActivity"("environment", "teamId", "year", "weekNum", "userId");

-- CreateIndex
CREATE INDEX "PersistReceipt_createdAt_idx" ON "PersistReceipt"("createdAt");

-- AddForeignKey
ALTER TABLE "SharedDoc" ADD CONSTRAINT "SharedDoc_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedDocSnapshot" ADD CONSTRAINT "SharedDocSnapshot_docId_fkey" FOREIGN KEY ("docId") REFERENCES "SharedDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocActivity" ADD CONSTRAINT "DocActivity_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocActivity" ADD CONSTRAINT "DocActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

