-- CreateTable
CREATE TABLE "BriefDocSnapshot" (
    "id" SERIAL NOT NULL,
    "docId" INTEGER NOT NULL,
    "ydoc" BYTEA NOT NULL,
    "docGeneration" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefDocSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefDocSnapshot_docId_createdAt_idx" ON "BriefDocSnapshot"("docId", "createdAt");

-- AddForeignKey
ALTER TABLE "BriefDocSnapshot" ADD CONSTRAINT "BriefDocSnapshot_docId_fkey" FOREIGN KEY ("docId") REFERENCES "BriefDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
