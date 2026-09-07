/**
 * 취합본 저장(restore) 준비 — 화면이 보낸 상태로 새 세대 문서를 만들고,
 * 저장된 문서와 내용이 같은지 판정한다.
 *
 * 세대를 올리면 접속자 전원이 끊기고 구세대 룸 정리가 돈다. 내용이 그대로인 저장에
 * 그 비용을 치를 이유가 없다(2026-09-04 저장 9회 중 2회가 내용 변화 0 이었다).
 * 비교는 문자열이 아니라 **문서**로 한다 — 화면 JSON 은 키 순서·생략된 기본값이
 * 저장본과 다르지만, 같은 상태를 빌드해 materialize 하면 같은 문자열이 된다.
 */
import type * as Y from 'yjs';
import { buildDocFromState, type EditorState, type SeedMeta } from './buildDoc';
import { materializeToJson } from './materialize';

export interface RestorePlan {
  doc: Y.Doc;
  /** persist 가 SharedDoc.contents 에 남길 값과 같은 형태 */
  materialized: string;
  /** 저장된 문서와 내용이 같다 — 세대를 올릴 필요가 없다 */
  unchanged: boolean;
}

export function planRestore(state: EditorState, existingContents: string, meta: SeedMeta): RestorePlan {
  const doc = buildDocFromState(state, meta);
  const materialized = materializeToJson(doc);
  return { doc, materialized, unchanged: materialized === existingContents };
}
