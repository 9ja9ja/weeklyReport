-- CreateTable
CREATE TABLE "Improvement" (
    "id" SERIAL NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '기타',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" INTEGER NOT NULL,
    "assigneeId" INTEGER,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Improvement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementComment" (
    "id" SERIAL NOT NULL,
    "improvementId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'comment',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImprovementComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Improvement_seq_key" ON "Improvement"("seq");

-- CreateIndex
CREATE INDEX "Improvement_status_createdAt_idx" ON "Improvement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImprovementComment_improvementId_createdAt_idx" ON "ImprovementComment"("improvementId", "createdAt");

-- AddForeignKey
ALTER TABLE "Improvement" ADD CONSTRAINT "Improvement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Improvement" ADD CONSTRAINT "Improvement_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementComment" ADD CONSTRAINT "ImprovementComment_improvementId_fkey" FOREIGN KEY ("improvementId") REFERENCES "Improvement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImprovementComment" ADD CONSTRAINT "ImprovementComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
