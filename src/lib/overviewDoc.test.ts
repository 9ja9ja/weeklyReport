/**
 * 내보내기 문서(PDF·구글 문서·엑셀 공통)의 작성자 표기.
 *
 * 소분류를 만든 사람만 찍으면, 그 아래 항목을 채운 사람이 임원 보고용 문서에서
 * 통째로 사라진다. 화면(취합본·개요)과 같은 규칙으로 합쳐 보여야 한다.
 */
import { describe, it, expect } from 'vitest';
import { buildOverviewHtml, type DocTeam } from './overviewDoc';
import type { ContentBlock } from './reportBlocks';

const RANGE = { monday: new Date('2026-09-14'), friday: new Date('2026-09-18') };
const NEXT_RANGE = { monday: new Date('2026-09-21'), friday: new Date('2026-09-25') };

function team(blocks: ContentBlock[]): DocTeam {
  return {
    id: 5, name: '플랫폼개발팀', division: '',
    isLocked: false, hasContent: true, includeAuthor: true, includeEmpty: true,
    parts: [{
      id: 1, name: '개발',
      majors: [{ id: 1, name: '공통', categories: [{ id: 38, middle: '공통', current: blocks, next: [] }] }]
    }]
  } as DocTeam;
}

function html(blocks: ContentBlock[]): string {
  return buildOverviewHtml({ teams: [team(blocks)], year: 2026, weekNum: 38, range: RANGE, nextRange: NEXT_RANGE });
}

describe('내보내기 문서 — 소분류 작성자', () => {
  it('항목을 쓴 사람이 소분류 이름에 함께 나온다', () => {
    const out = html([{
      id: 'a1', type: 'sub', subText: '공통', authorText: '양병석',
      bullets: [
        { id: 'b1', text: '로그 개선', authorText: '양병석' },
        { id: 'b2', text: '엑셀 오류 안내', authorText: '김소영' }
      ]
    } as ContentBlock]);
    expect(out).toContain('[양병석, 김소영]');
  });

  it('작성자 정보가 없는 기존 문서는 생성자만 나온다', () => {
    const out = html([{
      id: 'a1', type: 'sub', subText: '공통', authorText: '양병석',
      bullets: [{ id: 'b1', text: '로그 개선' }]
    } as ContentBlock]);
    expect(out).toContain('[양병석]');
  });

  it('팀장이 고정한 이름이면 그 값만 나온다', () => {
    const out = html([{
      id: 'a1', type: 'sub', subText: '공통', authorText: '개발1파트', authorPinned: true,
      bullets: [{ id: 'b1', text: 'x', authorText: '양병석' }]
    } as ContentBlock]);
    expect(out).toContain('[개발1파트]');
    expect(out).not.toContain('양병석');
  });

  it('파트 참여자 명단에 항목만 쓴 사람도 들어간다', () => {
    // 명단에서 빠지면 "이 파트에 누가 참여했나"가 실제와 어긋난다
    const out = html([{
      id: 'a1', type: 'sub', subText: '공통', authorText: '양병석',
      bullets: [{ id: 'b1', text: 'QC 대응', authorText: '이다영' }]
    } as ContentBlock]);
    expect(out).toContain('이다영');
  });
});
