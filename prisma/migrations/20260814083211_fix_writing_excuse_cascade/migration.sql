-- DropForeignKey
ALTER TABLE "WritingExcuse" DROP CONSTRAINT "WritingExcuse_teamId_fkey";

-- DropForeignKey
ALTER TABLE "WritingExcuse" DROP CONSTRAINT "WritingExcuse_userId_fkey";

-- AddForeignKey
ALTER TABLE "WritingExcuse" ADD CONSTRAINT "WritingExcuse_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingExcuse" ADD CONSTRAINT "WritingExcuse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
