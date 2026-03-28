-- Change ReportItem -> Category FK from CASCADE to RESTRICT
ALTER TABLE "ReportItem" DROP CONSTRAINT "ReportItem_categoryId_fkey";
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
