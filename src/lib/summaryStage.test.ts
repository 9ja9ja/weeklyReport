/**
 * 단계 판정 — 작성중 → 작성마감 → 취합완료.
 *
 * 이 규칙이 서버와 화면에서 갈리면 "화면은 편집 가능인데 저장은 409" 같은 상태가 된다.
 * 특히 공동 편집 주차에서 작성중인데도 편집이 열리면, 팀장이 다듬은 내용을
 * 룸의 다음 저장이 몇 초 뒤 덮어써 조용히 사라진다.
 */
import { describe, it, expect } from 'vitest';
import {
  summaryStage, membersCanWrite, membersCanWriteAt,
  masterCanEditSummary, canMasterEditAt, STAGE_LABEL
} from './summaryStage';

describe('summaryStage', () => {
  it('플래그 조합을 단계로 옮긴다', () => {
    expect(summaryStage(null)).toBe('open');
    expect(summaryStage({})).toBe('open');
    expect(summaryStage({ isClosed: true })).toBe('closed');
    expect(summaryStage({ isLocked: true })).toBe('locked');
    // 취합완료는 작성마감을 지나온 상태다 — 둘 다 서 있으면 취합완료가 이긴다
    expect(summaryStage({ isClosed: true, isLocked: true })).toBe('locked');
  });

  it('팀원은 작성중에만 쓸 수 있다', () => {
    expect(membersCanWriteAt('open')).toBe(true);
    expect(membersCanWriteAt('closed')).toBe(false);
    expect(membersCanWriteAt('locked')).toBe(false);
    expect(membersCanWrite({ isClosed: true })).toBe(false);
  });

  it('공동 편집 주차의 취합본은 작성마감 상태에서만 편집한다', () => {
    expect(canMasterEditAt('open', true)).toBe(false);   // 룸이 살아있어 덮어써진다
    expect(canMasterEditAt('closed', true)).toBe(true);
    expect(canMasterEditAt('locked', true)).toBe(false);
    expect(masterCanEditSummary({ isClosed: true }, true)).toBe(true);
    expect(masterCanEditSummary(null, true)).toBe(false);
  });

  it('개인 작성 주차는 예전처럼 취합완료 전까지 편집한다', () => {
    expect(canMasterEditAt('open', false)).toBe(true);
    expect(canMasterEditAt('locked', false)).toBe(false);
    expect(masterCanEditSummary(null, false)).toBe(true);
  });

  it('표기는 한 곳에서만 정한다', () => {
    expect(STAGE_LABEL.open).toBe('작성중');
    expect(STAGE_LABEL.closed).toBe('작성마감');
    expect(STAGE_LABEL.locked).toBe('취합완료');
  });
});
