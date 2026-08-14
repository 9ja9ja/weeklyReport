# Plan: "이번 주 작성 없음" 기능

## Context

주간보고 시스템에서 겸직·휴가 등으로 해당 주에 보고할 내용이 없는 팀원이 직접 "작성 없음"을 선언할 수 있는 기능. 현재는 아무것도 안 쓰면 "미작성"으로만 표시되어 팀장이 미작성과 의도적 미작성을 구분할 수 없다.

## Spec (agreed in chat)

- **누가**: 본인이 직접
- **어디서**: 작성 페이지(write)
- **액션**: "이번 주 작성 없음" 버튼 클릭 → 확인 → 저장
- **해제**: 작성 페이지 재진입 시 "취소하고 작성하기"로 되돌리기 가능
- **DB**: `WritingExcuse` 모델 (teamId, year, weekNum, userId, createdAt) — 복합 unique
- **상태 판정**: `hasReport || writingExcuse` → 미작성에서 제외
- **팀장 표시**: 초록 "완료"와 구분되는 회색 "작성없음" 별도 표기
- **취합본**: 작성없음 처리자는 취합 내용에 포함 안 됨 (기존과 동일)

## Global Constraints

- 레거시(개인 보고서) 모드와 공동 편집 모드 모두 동일하게 동작해야 함
- 이미 Report 또는 DocActivity가 있는 사용자는 excuse 불필요 (이미 작성완료)
- excuse가 있는 사용자도 마음이 바뀌면 해제 후 정상 작성 가능해야 함
- 작성 마감(closed) 또는 취합완료(locked) 상태에서는 excuse 생성/삭제 불가
- 겸직 사용자는 팀별로 독립적으로 excuse 처리 (팀A는 excuse, 팀B는 정상 작성 가능)
- 기존 테스트가 깨지면 안 됨
- excuse 상태는 `hasExcuse` boolean 필드로 기존 `hasReport` 옆에 전달

## Tasks

### Task 1: Prisma 스키마 — WritingExcuse 모델 추가 + 마이그레이션

`prisma/schema.prisma`에 `WritingExcuse` 모델 추가:

```prisma
model WritingExcuse {
  id        Int      @id @default(autoincrement())
  teamId    Int
  year      Int
  weekNum   Int
  userId    Int
  createdAt DateTime @default(now())

  team Team @relation(fields: [teamId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([teamId, year, weekNum, userId])
}
```

- `Team`, `User` 모델에 역참조 relation 필드 추가
- `npx prisma migrate dev --name add-writing-excuse` 실행
- `npx prisma generate` 확인

### Task 2: API 엔드포인트 — /api/reports/excuse

`src/app/api/reports/excuse/route.ts` 생성:

**POST** — excuse 생성
- body: `{ teamId, year, weekNum }`
- 세션에서 userId 추출 (기존 인증 패턴 따름)
- 검증: 해당 팀의 해당 주차가 open 상태인지 확인 (`summaryStage` 활용)
- 검증: 사용자가 해당 팀 소속인지 확인 (`UserTeam` 조회)
- upsert로 중복 방지
- 성공 시 200 반환

**DELETE** — excuse 해제
- body: `{ teamId, year, weekNum }`
- 세션에서 userId 추출
- 검증: 해당 팀의 해당 주차가 open 상태인지 확인
- 삭제 (없으면 무시)
- 성공 시 200 반환

기존 API 패턴 참고: `src/app/api/reports/route.ts`의 인증·검증 패턴을 따른다.

### Task 3: 상태 판정 로직 — hasExcuse 필드 추가

3곳에서 excuse 상태를 반영:

**A. `/api/users` (GET, withStatus=true)**
- `src/app/api/users/route.ts`에서 `hasReport` 계산 로직 옆에 `WritingExcuse` 조회 추가
- 응답에 `hasExcuse: boolean` 필드 추가

**B. `/api/teams` (GET, withUsers=true)**
- `src/app/api/teams/route.ts`에서 동일하게 excuse 조회 + `hasExcuse` 필드 추가

**C. `collabStatus.ts`**
- `src/lib/collabStatus.ts`의 `CollabStatus` 클래스에 excuse 상태 통합은 불필요 — excuse는 별도 쿼리로 처리

**상태 판정 변경:**
- 기존: `hasReport` → 완료/미작성
- 변경: `hasReport` → 완료, `!hasReport && hasExcuse` → 작성없음, `!hasReport && !hasExcuse` → 미작성

### Task 4: 작성 페이지 UI — "이번 주 작성 없음" 버튼

`src/app/write/page.tsx`에 기능 추가:

- 각 팀 탭 내에서, 해당 팀/주차가 open 상태일 때 "이번 주 작성 없음" 버튼 표시
- 이미 작성 내용이 있으면(Report 또는 DocActivity) 버튼 비활성화 또는 숨김
- 클릭 시 확인 다이얼로그 → POST /api/reports/excuse 호출
- excuse 상태이면 "작성 없음 처리됨" 안내 + "취소하고 작성하기" 버튼 표시
- "취소하고 작성하기" 클릭 시 DELETE /api/reports/excuse 호출 → 정상 작성 모드로 복귀
- 페이지 진입 시 excuse 상태 확인 필요: GET /api/reports/excuse?teamId=X&year=Y&weekNum=W 또는 기존 데이터에 포함

Task 2에 GET 엔드포인트 추가: `GET /api/reports/excuse?teamId=X&year=Y&weekNum=W` — 현재 사용자의 excuse 존재 여부 반환.

### Task 5: 팀장/메인 화면 표시 — 회색 "작성없음" 표기

3곳의 표시 로직 업데이트:

**A. 대시보드 사이드바** (`src/app/dashboard/page.tsx`)
- 기존: 완료(초록) / 미작성(빨강)
- 변경: 완료(초록) / 작성없음(회색) / 미작성(빨강)
- doneCount 계산에 excuse도 포함 (미작성 카운트에서 제외)

**B. 취합본 페이지 작성 현황** (`src/app/summary/page.tsx`)
- 개인별 뱃지에 "작성없음" 회색 표기 추가
- 작성 마감 확인 다이얼로그에서 미작성 목록에서 excuse 제외

**C. 메인 페이지** (`src/app/page.tsx`)
- 팀별 완료 카운트에 excuse 포함
- 개인별 상태에 "작성없음" 회색 표기 추가
