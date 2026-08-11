-- 권한 잠금 — 마지막 관리 계정을 실수로 내리거나 지우지 못하게 한다.
-- 화면에서는 켜고 끌 수 없고 DB 로만 바꾼다.
ALTER TABLE "User" ADD COLUMN "roleLocked" BOOLEAN NOT NULL DEFAULT false;
