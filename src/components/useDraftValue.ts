'use client';

import { useState } from 'react';

/**
 * 입력칸이 "내가 방금 친 값"을 문서가 따라잡을 때까지 들고 있게 한다.
 *
 * 공동 편집에서 입력은 Y.Doc 을 거쳐 **한 프레임 뒤에** value 로 돌아온다
 * (useSharedDoc 의 useDocSnapshot 이 requestAnimationFrame 으로 재계산을 묶는다).
 * 그 사이에 옛 value 를 그대로 그리면 방금 친 글자가 DOM 에서 지워지고,
 * 한글은 다음 음절이 그 지워진 자리 위에서 조합돼 **직전 음절이 통째로 사라진다**
 * ("구분" → "분", "CMS등록" → "CMS록"). 개인 작성은 state 가 동기로 갱신돼 이 창이 없다.
 *
 * 그래서 값을 보낸 뒤에도 초안을 쥐고 있다가, 문서가 같은 값을 돌려줄 때 놓는다.
 * 칸을 떠날 때(blur)도 놓아, 그 사이 남이 고친 값이 있으면 문서 쪽으로 되돌아간다.
 */
export function useDraftValue(value: string) {
  const [draft, setDraft] = useState<string | null>(null);

  // 문서가 내 값을 따라잡으면 초안을 놓는다. 렌더 중에 조정한다 —
  // effect 로 미루면 한 프레임 더 늦어 그 사이 값이 또 흔들린다.
  if (draft !== null && draft === value) setDraft(null);

  return {
    /** 화면에 그릴 값 */
    shown: draft ?? value,
    /** 내가 친 값을 기억한다 (문서로 보내는 것과 별개) */
    hold: setDraft,
    /** 초안을 놓고 문서 값으로 돌아간다 */
    release: () => setDraft(null)
  };
}
