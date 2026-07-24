-- 서비스본부 전체 확장: 파트(분류1) 레벨 신설 + 겸직 지원
--
-- 계층 변경
--   기존: Team > MajorCategory(대분류) > Category(중분류)
--   변경: Team > Part(분류1) > MajorCategory(대분류) > Category(중분류)
--
-- 기존 데이터는 팀별 기본 파트를 자동 생성해 이관한다. Report/ReportItem은 건드리지 않는다.

-- ── 1. Team: 구분(division) / 정렬 ──────────────────────────────
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "division" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "orderIdx" INTEGER NOT NULL DEFAULT 0;

UPDATE "Team" SET "division" = 'Pharos' WHERE "name" = '기획팀' AND "division" = '';

-- ── 2. User: 직급 / 재직여부 ────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "position" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ── 3. Part 신설 ────────────────────────────────────────────────
CREATE TABLE "Part" (
    "id"        SERIAL       NOT NULL,
    "name"      TEXT         NOT NULL,
    "teamId"    INTEGER      NOT NULL,
    "orderIdx"  INTEGER      NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN      NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Part_teamId_name_key" ON "Part"("teamId", "name");
ALTER TABLE "Part" ADD CONSTRAINT "Part_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. UserTeam 신설 (겸직) ─────────────────────────────────────
CREATE TABLE "UserTeam" (
    "id"        SERIAL       NOT NULL,
    "userId"    INTEGER      NOT NULL,
    "teamId"    INTEGER      NOT NULL,
    "isPrimary" BOOLEAN      NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTeam_userId_teamId_key" ON "UserTeam"("userId", "teamId");
CREATE INDEX "UserTeam_teamId_idx" ON "UserTeam"("teamId");
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 소속을 주 소속으로 이관
INSERT INTO "UserTeam" ("userId", "teamId", "isPrimary")
SELECT "id", "teamId", true FROM "User"
ON CONFLICT ("userId", "teamId") DO NOTHING;

-- ── 5. 기본 파트 생성 (팀명 → 파트명) ───────────────────────────
-- 기획팀은 '기획', 디자인팀은 '디자인', 그 외 기존 팀은 팀 이름을 그대로 파트명으로 쓴다.
INSERT INTO "Part" ("name", "teamId", "orderIdx")
SELECT CASE t."name" WHEN '기획팀' THEN '기획' WHEN '디자인팀' THEN '디자인' ELSE t."name" END, t."id", 0
FROM "Team" t
ON CONFLICT ("teamId", "name") DO NOTHING;

-- ── 6. MajorCategory: partId ───────────────────────────────────
ALTER TABLE "MajorCategory" ADD COLUMN "partId" INTEGER;

UPDATE "MajorCategory" mc
SET "partId" = p."id"
FROM "Part" p
WHERE p."teamId" = mc."teamId" AND p."orderIdx" = 0;

ALTER TABLE "MajorCategory" ALTER COLUMN "partId" SET NOT NULL;
ALTER TABLE "MajorCategory" ADD CONSTRAINT "MajorCategory_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "MajorCategory_teamId_name_key";
CREATE UNIQUE INDEX "MajorCategory_partId_name_key" ON "MajorCategory"("partId", "name");
CREATE INDEX "MajorCategory_teamId_idx" ON "MajorCategory"("teamId");

-- ── 7. Category: partId ────────────────────────────────────────
ALTER TABLE "Category" ADD COLUMN "partId" INTEGER;

UPDATE "Category" c
SET "partId" = p."id"
FROM "Part" p
WHERE p."teamId" = c."teamId" AND p."orderIdx" = 0;

ALTER TABLE "Category" ALTER COLUMN "partId" SET NOT NULL;
ALTER TABLE "Category" ADD CONSTRAINT "Category_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Category_teamId_major_middle_key";
CREATE UNIQUE INDEX "Category_partId_major_middle_key" ON "Category"("partId", "major", "middle");
CREATE INDEX "Category_teamId_idx" ON "Category"("teamId");
