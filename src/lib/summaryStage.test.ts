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
  masterCanEditSummary, canMasterEditAt, STAGE_LABEL, stageTransition
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

/**
 * 단계 전환 시 잠금 레코드에 적을 값.
 *
 * 작성마감 시각(closedAt)은 "팀원 입력이 언제 멈췄나"의 유일한 기록이다. 취합완료로 넘어갈 때
 * 이 값을 지금 시각으로 덮어쓰면 작성마감과 취합완료가 같은 시각이 되어 사후 분석에서
 * 작성마감 시점을 잃는다(2026-09-04 t5·t6 모두 closedAt == lockedAt 이었다).
 */
describe('stageTransition', () => {
  const now = new Date('2026-09-04T08:28:00Z');
  const earlier = new Date('2026-09-04T01:26:53Z');
  const me = 31;

  it('작성중 → 작성마감: 지금 시각과 나를 마감자로 적는다', () => {
    expect(stageTransition('closed', true, me, now, null)).toEqual({
      isLocked: false, lockedBy: null, lockedAt: null,
      isClosed: true, closedBy: me, closedAt: now
    });
  });

  it('작성마감 → 취합완료: 작성마감 시각·마감자를 덮어쓰지 않는다', () => {
    const d = stageTransition('locked', true, 99, now, { isClosed: true, closedBy: me, closedAt: earlier });
    expect(d.isLocked).toBe(true);
    expect(d.lockedBy).toBe(99);
    expect(d.lockedAt).toBe(now);
    expect(d.isClosed).toBe(true);
    expect(d.closedBy).toBe(me);
    expect(d.closedAt).toBe(earlier);
  });

  it('취합완료 해제 → 작성마감: 원래 작성마감 시각을 그대로 둔다', () => {
    expect(stageTransition('closed', true, 99, now, { isClosed: true, closedBy: me, closedAt: earlier })).toEqual({
      isLocked: false, lockedBy: null, lockedAt: null,
      isClosed: true, closedBy: me, closedAt: earlier
    });
  });

  it('작성중으로 되돌리면 마감 기록을 비운다', () => {
    expect(stageTransition('open', true, me, now, { isClosed: true, closedBy: me, closedAt: earlier })).toEqual({
      isLocked: false, lockedBy: null, lockedAt: null,
      isClosed: false, closedBy: null, closedAt: null
    });
  });

  it('개인 작성 주차의 취합완료는 작성마감을 세우지 않는다', () => {
    expect(stageTransition('locked', false, me, now, null)).toEqual({
      isLocked: true, lockedBy: me, lockedAt: now,
      isClosed: false, closedBy: null, closedAt: null
    });
  });

  it('마감 상태인데 시각이 비어 있는 옛 레코드는 지금 시각으로 채운다', () => {
    const d = stageTransition('locked', true, me, now, { isClosed: true, closedBy: null, closedAt: null });
    expect(d.closedAt).toBe(now);
    expect(d.closedBy).toBe(me);
  });
});
