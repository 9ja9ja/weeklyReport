-- CreateTable: MajorCategory
CREATE TABLE "MajorCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "orderIdx" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MajorCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MajorCategory_name_key" ON "MajorCategory"("name");

-- Seed initial major categories from existing data
INSERT INTO "MajorCategory" ("name", "orderIdx") VALUES ('서비스', 0), ('제휴', 1), ('운영', 2)
ON CONFLICT ("name") DO NOTHING;
