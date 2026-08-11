-- 팀 안에서의 팀원 표시 순서 (임원처럼 직급 순으로 보여야 하는 팀이 있다)
-- 기본값 999: 지정하지 않은 사람은 이름순으로 뒤에 붙는다.
ALTER TABLE "UserTeam" ADD COLUMN "orderIdx" INTEGER NOT NULL DEFAULT 999;
