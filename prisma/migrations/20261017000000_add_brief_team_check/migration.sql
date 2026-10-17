-- AlterTable
ALTER TABLE "Team" ADD COLUMN "briefExcluded" BOOLEAN NOT NULL DEFAULT false;

-- 요약본 팀별 작성 체크 대상에서 뺄 조직
--  · PMO, 땡겨요: 팀이 아니라 프로젝트성 조직
--  · 비즈니스플랫폼본부: 임원 계정만 모인 그룹 행(작성 주체가 아님)
UPDATE "Team" SET "briefExcluded" = true WHERE "name" IN ('PMO', '땡겨요', '비즈니스플랫폼본부');

-- CreateTable
CREATE TABLE "BriefTeamCheck" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "checkedBy" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefTeamCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefTeamCheck_year_weekNum_idx" ON "BriefTeamCheck"("year", "weekNum");

-- CreateIndex
CREATE UNIQUE INDEX "BriefTeamCheck_teamId_year_weekNum_key" ON "BriefTeamCheck"("teamId", "year", "weekNum");

-- AddForeignKey
ALTER TABLE "BriefTeamCheck" ADD CONSTRAINT "BriefTeamCheck_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BriefAttachment" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "storageKey" TEXT NOT NULL,
    "uploadedBy" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefMailRecipient" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'cc',
    "orderIdx" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefMailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefMailLog" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "sentBy" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "attachments" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefMailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefAttachment_year_weekNum_idx" ON "BriefAttachment"("year", "weekNum");

-- CreateIndex
CREATE UNIQUE INDEX "BriefMailRecipient_email_key" ON "BriefMailRecipient"("email");

-- CreateIndex
CREATE INDEX "BriefMailLog_year_weekNum_idx" ON "BriefMailLog"("year", "weekNum");

-- AddForeignKey
ALTER TABLE "BriefAttachment" ADD CONSTRAINT "BriefAttachment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
