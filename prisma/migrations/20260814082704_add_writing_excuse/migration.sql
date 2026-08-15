-- CreateTable
CREATE TABLE "WritingExcuse" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "weekNum" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingExcuse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WritingExcuse_teamId_year_weekNum_userId_key" ON "WritingExcuse"("teamId", "year", "weekNum", "userId");

-- AddForeignKey
ALTER TABLE "WritingExcuse" ADD CONSTRAINT "WritingExcuse_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingExcuse" ADD CONSTRAINT "WritingExcuse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
