-- 1. Create Team table
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- 2. Insert default team
INSERT INTO "Team" ("name") VALUES ('기획팀');

-- 3. Add teamId (nullable) and role to User
ALTER TABLE "User" ADD COLUMN "teamId" INTEGER;
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- 4. Backfill User teamId
UPDATE "User" SET "teamId" = 1;

-- 5. Migrate isMaster to role
UPDATE "User" SET "role" = 'superAdmin' WHERE "name" = '구자영';
UPDATE "User" SET "role" = 'teamMaster' WHERE "isMaster" = true AND "name" != '구자영';

-- 6. Make teamId NOT NULL and add FK
ALTER TABLE "User" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Drop old unique, add new unique
DROP INDEX "User_name_key";
CREATE UNIQUE INDEX "User_teamId_name_key" ON "User"("teamId", "name");

-- 8. Drop isMaster column
ALTER TABLE "User" DROP COLUMN "isMaster";

-- 9. Add teamId to MajorCategory
ALTER TABLE "MajorCategory" ADD COLUMN "teamId" INTEGER;
UPDATE "MajorCategory" SET "teamId" = 1;
ALTER TABLE "MajorCategory" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "MajorCategory" ADD CONSTRAINT "MajorCategory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "MajorCategory_name_key";
CREATE UNIQUE INDEX "MajorCategory_teamId_name_key" ON "MajorCategory"("teamId", "name");

-- 10. Add teamId to Category
ALTER TABLE "Category" ADD COLUMN "teamId" INTEGER;
UPDATE "Category" SET "teamId" = 1;
ALTER TABLE "Category" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "Category" ADD CONSTRAINT "Category_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "Category_major_middle_key";
CREATE UNIQUE INDEX "Category_teamId_major_middle_key" ON "Category"("teamId", "major", "middle");

-- 11. Add teamId to SummaryData
ALTER TABLE "SummaryData" ADD COLUMN "teamId" INTEGER;
UPDATE "SummaryData" SET "teamId" = 1;
ALTER TABLE "SummaryData" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "SummaryData" ADD CONSTRAINT "SummaryData_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "SummaryData_year_weekNum_key";
CREATE UNIQUE INDEX "SummaryData_teamId_year_weekNum_key" ON "SummaryData"("teamId", "year", "weekNum");

-- 12. Add teamId to SummaryLock
ALTER TABLE "SummaryLock" ADD COLUMN "teamId" INTEGER;
UPDATE "SummaryLock" SET "teamId" = 1;
ALTER TABLE "SummaryLock" ALTER COLUMN "teamId" SET NOT NULL;
ALTER TABLE "SummaryLock" ADD CONSTRAINT "SummaryLock_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "SummaryLock_year_weekNum_key";
CREATE UNIQUE INDEX "SummaryLock_teamId_year_weekNum_key" ON "SummaryLock"("teamId", "year", "weekNum");
