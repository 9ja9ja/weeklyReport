-- 작성마감 단계 — 팀원 입력을 멈추고 팀장이 취합본에서 정리하는 중간 상태.
-- 공동 편집 주차에서만 쓴다. 룸이 살아있는 채로 취합본을 고치면 룸의 다음 저장이 덮어쓴다.
ALTER TABLE "SummaryLock" ADD COLUMN "isClosed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SummaryLock" ADD COLUMN "closedBy" INTEGER;
ALTER TABLE "SummaryLock" ADD COLUMN "closedAt" TIMESTAMP(3);

-- 이미 취합완료된 주차는 작성마감을 지나온 것으로 본다.
-- 그래야 취합완료를 해제했을 때 작성중(팀원 입력 재개)이 아니라 작성마감으로 돌아간다.
UPDATE "SummaryLock" SET "isClosed" = true, "closedBy" = "lockedBy", "closedAt" = "lockedAt" WHERE "isLocked" = true;
