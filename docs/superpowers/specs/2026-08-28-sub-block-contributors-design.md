# 소분류 작성자 표기 — 생성자 + 항목 입력자 합집합

작성일: 2026-08-28
상태: 설계 확정 (구현 전)

## 배경

동시작성(공동 편집) 팀의 소분류 옆 작성자 이름은 지금 **그 소분류를 만든 사람 한 명**이다.
소분류 아래 항목(불릿)을 다른 사람이 입력해도 이름에 드러나지 않아, 취합본·개요를 볼 때
실제로 누가 무엇을 썼는지 알 수 없다.

```
⑴ 공통 [양병석]                             ← 소분류를 만든 사람만
  - 로그 개선 - 요청 추적 키(traceId) 추가      ← 이 세 줄을 누가 썼는지는 알 수 없다
  - 엑셀 암호화 업로드 오류 안내 개선
  - 파일 업로드 요청 관련 예외 처리 추가
```

목표는 **소분류 생성자와 그 소분류 하위 항목을 입력한 사람들을 합쳐서** 보여주는 것이다.

## 현재 구조

```
YBlock(sub) = Y.Map {
  type, order, authorId, authorText,        ← 생성자 1명
  subText: Y.Text,
  bullets: Y.Map<bulletId, Y.Map{ order, text }>   ← 작성자 정보 없음
}
```

항목에는 작성자 정보가 **아예 저장되지 않는다.** 따라서 표시 로직만 바꿔서는 불가능하고,
Y.Doc 스키마에 항목별 작성자를 추가해야 한다. 그 결과 `Bullet` 타입과 materialize 출력
계약이 바뀌며, 이 계약은 개요·PDF·엑셀 내보내기·취합본·클립보드 복사가 모두 읽는다.

### 기대 효과의 크기 (2026 34~35주차 운영 문서 316개 소분류)

| 구성 | 개수 | 비율 |
|---|---|---|
| 항목 0개 (소분류 제목이 곧 내용) | 145 | 45.9% |
| 항목 1개 | 95 | 30.1% |
| 항목 2개 이상 (여러 명이 섞일 수 있는 구간) | 76 | 24.1% |
| 표 블록 | 25 | (전체의 7%) |

표기가 실제로 달라지는 것은 **최대 24%** 구간이다. 기능을 뺄 이유는 아니지만
(신고의 계기가 된 사례가 이 구간이다) 기대치는 이 정도로 둔다.

## 결정 사항

| 질문 | 결정 |
|---|---|
| 어느 화면까지 | 작성화면·취합본·개요·PDF·엑셀·복사 **전부 동일** |
| 팀장이 이름을 손으로 고쳤을 때 | **수동 값이 이긴다** (그 소분류만 자동 계산 중단) |
| 표(table) 블록 | **제외** — 지금처럼 만든 사람만 표시 |

## 데이터 모델

```ts
// src/lib/reportBlocks.ts
export type Bullet = {
  id: string;
  text: string;
  authorId?: number | null;   // 신규 — 이 항목을 입력한 사람
  authorText?: string;        // 신규 — 표시용 이름(원저자 보존)
};

export type SubBlock = {
  // 기존: authorId, authorText — 소분류 생성자 또는 팀장 지정값
  authorPinned?: boolean;     // 신규 — 팀장이 이름칸을 손댔는가
  // ...
};
```

Y.Doc 쪽은 bullet `Y.Map` 에 `authorId`/`authorText`, 블록 `Y.Map` 에 `authorPinned` 키를
추가한다. `src/lib/realtime/schema.ts` 의 `BLOCK` 상수에 `authorPinned` 를 더한다
(`authorId`/`authorText` 는 이미 있다).

세 필드 모두 **선택 필드**다. 기존 문서와 개인 작성(legacy) 보고서는 값이 없는 채로
그대로 열리고, 아래 표시 규칙에 따라 지금과 똑같이 동작한다.

## 표시 규칙 — 함수 하나

```ts
// src/lib/reportBlocks.ts
export function authorLabel(b: SubBlock): string {
  if (b.authorPinned) return b.authorText ?? '';
  const names = [b.authorText, ...b.bullets.map(x => x.authorText)];
  return [...new Set(names.filter(Boolean))].join(', ');
}
```

- **순서**: 생성자 먼저, 그다음 항목이 놓인 순서대로 첫 등장 순 — 읽는 순서와 같다
- **중복 제거 기준은 표시 이름(`authorText`)**: 팀 안에서 이름은 유일하고
  (`User @@unique([teamId, name])`) 한 소분류는 한 팀에 속하므로 동명이인 충돌이 없다.
  팀장이 넣은 자유 텍스트("재영·민수")도 같은 규칙으로 한 항목처럼 다뤄진다.
- **인원 상한 없음**: 소분류당 항목이 평균 1개 수준이라 이름이 길게 늘어질 여지가 작다
- **빈 문자열을 돌려줄 수 있다**(이름이 하나도 없거나 팀장이 지운 경우). 호출부는 지금도
  `b.authorText &&` 로 감싸 표시하므로, 그 조건을 `authorLabel(b)` 결과로 바꾸면 된다 —
  대괄호만 덩그러니 남는 `[]` 출력이 생기지 않도록 이 점을 각 호출부에서 확인한다.

이 규칙을 화면마다 따로 구현하면 같은 소분류가 화면마다 다른 이름으로 보인다.
`src/lib/collabStatus.ts` 가 작성 현황 판정을 한 곳에 모아 둔 것과 같은 이유로,
아래 호출부는 전부 이 함수만 부른다.

| 파일 | 지점 | 용도 |
|---|---|---|
| `src/app/summary/page.tsx` | 표시 / 복사 / 이름칸 | 팀별 취합본 |
| `src/app/overview/page.tsx` | 표시 / 복사 | 전체 취합본 |
| `src/lib/overviewDoc.ts` | 본문 / 참여자 명단 | PDF·구글 문서·엑셀 (공통) |

`src/components/TableBlock.tsx` 는 표이므로 손대지 않는다(기존 `authorText` 유지).

## 쓰기 경로

- `addBullet(...)` 에 작성자 인자를 추가한다. 작성화면이 블록 생성 시 이미 넘기고 있는
  `{ authorId, authorText }`(`src/app/write/page.tsx:477`)를 항목 추가에도 같은 방식으로 전달한다.
- 취합본의 이름칸(`summary/page.tsx`)을 수정하면 `authorPinned = true` 로 표시한다.
  **빈칸으로 지우면 이름이 숨겨진다** — "자동 계산으로 되돌아간다"보다 예측 가능하다.

## 계약 보존 — 이 작업의 핵심 위험

공동 편집 주차의 취합본 저장(`POST /api/reports/summary`)은 `buildDocFromState` 로
**EditorState JSON 에서 Y.Doc 을 통째로 재구성(치환)** 한다. 따라서 세 필드가
`buildDoc ↔ materialize` 양쪽에 모두 없으면, 팀장이 취합본을 한 번 저장하는 순간
항목 작성자가 전부 사라진다.

`src/lib/realtime/roundtrip.test.ts` 의 무작위 100건 왕복 항등성 테스트에 새 필드를
포함시켜 이것을 강제한다.

이월(carry)은 `src/lib/realtime/seed.ts` 가 블록 `authorId`/`authorText` 의 원저자를
유지하는 것과 **같은 정책**으로 항목 작성자도 유지한다.

## 테스트

1. `authorLabel` 단위 — 합집합 / 중복 제거 / `authorPinned` 우선 / 빈칸 숨김 /
   **작성자 정보가 없는 기존 데이터에서 기존과 동일한 결과**
2. 왕복 항등성에 새 필드 포함 (기존 무작위 100건에 반영)
3. 취합본 저장(restore) 후 항목 작성자 보존
4. 이월(seed) 후 항목 작성자 보존

## 범위 밖

- **표 블록** — 셀 단위 작성자 추적이 필요해 작업량과 문서 용량이 크게 늘고, 표는 25개(7%)로
  적으며 보통 한 사람이 통째로 구성한다.
- **요약본(Brief)** — 본문이 TipTap HTML 이라 이 블록 구조 자체가 없다.
- **소급 적용** — 기존 항목에는 작성자 정보가 없어 되살릴 수 없다. 적용 이후 새로 입력하는
  항목부터 반영되고, 그전 것들은 계속 생성자만 표시된다.
