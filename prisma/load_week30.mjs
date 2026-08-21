/**
 * 30주차 주간보고 적재
 *
 * 원본: 상세본_서비스본부_주간_보고_2026년_30주차.docx → w30.json (계층 추출본)
 * 문서의 [이름] 표기를 작성자로 쓰고, 없으면 담당 컬럼 → 팀 대표 순으로 배정한다.
 *
 * 실행: DATABASE_URL=... node prisma/load_week30.mjs <w30.json> [--dry]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

console.error('LEGACY: 이 스크립트는 2026-08 조직개편 이전 팀명을 사용합니다. 실행하려면 이 블록을 제거하세요.');
process.exit(1);

const prisma = new PrismaClient();
const YEAR = 2026;
const WEEK = 30;

const jsonPath = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!jsonPath) {
  console.error('사용법: node prisma/load_week30.mjs <w30.json> [--dry]');
  process.exit(1);
}

const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();

/**
 * 문서는 금주/차주에 같은 항목을 "(계속)", "(상시)", "(07.23.기준)" 처럼
 * 접미사만 바꿔 적는다. 중분류가 갈라지지 않도록 꼬리 괄호를 떼고도 비교한다.
 */
const SUFFIX_RE = /\s*\((계속|상시|~?계속|진행중|[^)]*기준|단위[^)]*)\)\s*$/;
const loose = (s) => norm((s || '').replace(SUFFIX_RE, ''));
const genId = (() => { let n = 0; return () => `w30${(++n).toString(36)}`; })();

// 문서의 축약형 분류2를 정식 파트명(=대분류)으로 통일한다.
// 예: 분류1 "서울신용보증보험" / 분류2 "서울신보" → 같은 대상이므로 정식명으로 맞춤.
const MAJOR_ALIAS = {
  서울신보: '서울신용보증보험',
  경기신보: '경기신용보증보험'
};
const majorOf = (b2, b1) => MAJOR_ALIAS[b2] || b2 || b1;

/** 문서 (구분, 분류1, 분류2) → (팀, 파트, 대분류) */
function mapRow(r) {
  const { gubun, b1, b2 } = r;
  switch (gubun) {
    case 'Pharos':
      if (b1 === '기획') return { team: '기획팀', part: '기획', major: b2 };
      if (b1 === '디자인') return { team: '디자인팀', part: '디자인', major: '디자인' };
      if (b1 === '개발') return { team: '파로스 개발팀', part: '개발', major: b2 };
      return null;
    case '개발':
      return { team: 'BIG팀', part: b1, major: majorOf(b2, b1) };
    case '영업':
      return { team: '영업팀', part: b1, major: b1 };
    case '마케팅':
      if (b1 === '내부') return { team: '파로스 마케팅', part: '내부', major: b2 };
      if (b1 === '제휴') return { team: '파로스 제휴', part: '제휴', major: b2 };
      return null;
    case '운영':
      if (b1 === '핑거') return { team: '파로스 CRM', part: '핑거', major: b2 };
      if (norm(b1) === norm('땡겨요 사업단')) return { team: '땡겨요', part: '땡겨요 사업단', major: b2 };
      if (norm(b1) === norm('기업디지털 전담반')) return { team: 'CMS팀', part: '기업디지털 전담반', major: b2 };
      return null;
    case 'PMO':
      return { team: 'PMO', part: 'PMO', major: 'PMO' };
    default:
      return null;
  }
}

/** 담당 컬럼 → 실명 목록 ("BIG"·"DEV" 같은 팀 라벨과 "외 16명" 제거) */
function parseDamdang(s) {
  if (!s) return [];
  return s
    .replace(/외\s*\d+\s*명/g, ' ')
    .split(/[\s,]+/)
    .map((t) => t.replace(/\(P\)$/, '').trim())
    .filter((t) => t && !/^(BIG|DEV|BIGDEV|BIG-S)$/i.test(t));
}

const AUTHOR_RE = /\[([^[\]]{2,20})\]\s*$/;

async function main() {
  const rows = JSON.parse(readFileSync(jsonPath, 'utf8'));

  // ── 참조 데이터 ─────────────────────────────
  const teams = await prisma.team.findMany({
    include: {
      parts: { include: { majorCategories: true, categories: true } },
      userTeams: { include: { user: true } }
    }
  });
  const teamByName = new Map(teams.map((t) => [t.name, t]));
  const usersByName = new Map();
  (await prisma.user.findMany()).forEach((u) => {
    if (!usersByName.has(u.name)) usersByName.set(u.name, u);
  });

  const warn = [];
  /** (userId, categoryId) → {current, next} */
  const bucket = new Map();
  let createdCats = 0;

  const put = (userId, categoryId, kind, blocks) => {
    const key = `${userId}:${categoryId}`;
    if (!bucket.has(key)) bucket.set(key, { userId, categoryId, current: [], next: [] });
    bucket.get(key)[kind].push(...blocks);
  };

  for (const r of rows) {
    const map = mapRow(r);
    if (!map) { warn.push(`r${r.row}: 매핑 규칙 없음 (${r.gubun}/${r.b1}/${r.b2})`); continue; }
    if (r.current.length === 0 && r.next.length === 0) continue;

    const team = teamByName.get(map.team);
    if (!team) { warn.push(`r${r.row}: 팀 '${map.team}' 없음`); continue; }

    const part = team.parts.find((p) => norm(p.name) === norm(map.part));
    if (!part) { warn.push(`r${r.row}: 파트 '${map.part}' (${map.team}) 없음`); continue; }

    const major = part.majorCategories.find((m) => norm(m.name) === norm(map.major));
    if (!major) { warn.push(`r${r.row}: 대분류 '${map.major}' (${map.part}) 없음`); continue; }

    // 이 팀에서 작성 가능한 사람들 (겸직 포함)
    const teamMembers = team.userTeams.map((ut) => ut.user);
    const damdang = parseDamdang(r.damdang)
      .map((n) => usersByName.get(n))
      .filter(Boolean);
    const fallbackPool = damdang.length > 0 ? damdang : teamMembers;
    if (fallbackPool.length === 0) { warn.push(`r${r.row}: ${map.team} 작성자 없음`); continue; }

    let rr = 0;
    const nextFallback = () => fallbackPool[rr++ % fallbackPool.length];

    for (const kind of ['current', 'next']) {
      for (const mid of r[kind]) {
        if (!mid.middle) continue;
        const midName = mid.middle.trim();

        // 중분류 찾기 — 정확히 일치 → 접미사 무시 일치 → 없으면 생성
        const sameMajor = part.categories.filter((c) => norm(c.major) === norm(major.name));
        let cat =
          sameMajor.find((c) => norm(c.middle) === norm(midName)) ??
          sameMajor.find((c) => loose(c.middle) === loose(midName));
        if (!cat) {
          if (DRY) {
            warn.push(`r${r.row}: [신규] 중분류 '${midName}' (${map.part}>${major.name})`);
            continue;
          }
          const last = part.categories.filter((c) => c.major === major.name).length;
          cat = await prisma.category.create({
            data: { major: major.name, middle: midName, partId: part.id, teamId: team.id, orderIdx: last }
          });
          part.categories.push(cat);
          createdCats++;
        }

        // 블록 → 작성자별로 나눈다
        let lastAuthor = null;
        const perAuthor = new Map();

        for (const b of mid.blocks) {
          if (b.type === 'table') {
            const who = lastAuthor ?? nextFallback();
            if (!perAuthor.has(who.id)) perAuthor.set(who.id, []);
            perAuthor.get(who.id).push({
              id: genId(),
              type: 'table',
              caption: '',
              headers: b.headers,
              rows: b.rows
            });
            continue;
          }

          let text = (b.text || '').trim();
          let bullets = (b.bullets || []).map((x) => x.trim()).filter(Boolean);

          // 표 뒤에 딸린 설명만 있는 경우 첫 불릿을 본문으로 올린다
          if (!text && bullets.length > 0) text = bullets.shift();
          if (!text) continue;
          if (norm(text) === '내용없음' || norm(text) === '별도대응없음') continue;

          // [이름] 표기가 있으면 그 사람이 작성자
          // "[윤난희, 박종민]" 처럼 여러 명이면 첫 번째를 작성자로 본다
          let who = null;
          const m = text.match(AUTHOR_RE);
          if (m) {
            const names = m[1].split(/[,、·/]/).map((x) => x.trim()).filter(Boolean);
            const u = names.map((n) => usersByName.get(n)).find(Boolean);
            if (u) { who = u; text = text.replace(AUTHOR_RE, '').trim(); }
          }
          if (who) lastAuthor = who;
          else who = lastAuthor ?? nextFallback();

          if (!perAuthor.has(who.id)) perAuthor.set(who.id, []);
          perAuthor.get(who.id).push({
            id: genId(),
            type: 'sub',
            subText: text,
            bullets: bullets.map((t) => ({ id: genId(), text: t }))
          });
        }

        for (const [userId, blocks] of perAuthor) {
          if (blocks.length > 0) put(userId, cat.id, kind, blocks);
        }
      }
    }
  }

  // ── 적재 ────────────────────────────────────
  const byUser = new Map();
  for (const v of bucket.values()) {
    if (!byUser.has(v.userId)) byUser.set(v.userId, []);
    byUser.get(v.userId).push(v);
  }

  console.log(`\n대상: 작성자 ${byUser.size}명 / 보고항목 ${bucket.size}건` + (createdCats ? ` / 중분류 신규 ${createdCats}건` : ''));

  if (DRY) {
    if (warn.length) { console.log('\n[확인 필요]'); warn.forEach((w) => console.log('  -', w)); }
    return;
  }

  // 기존 30주차 데이터 정리 후 재적재
  const old = await prisma.report.findMany({ where: { year: YEAR, weekNum: WEEK }, select: { id: true } });
  if (old.length > 0) {
    await prisma.reportItem.deleteMany({ where: { reportId: { in: old.map((r) => r.id) } } });
    await prisma.report.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }
  await prisma.summaryData.deleteMany({ where: { year: YEAR, weekNum: WEEK } });

  for (const [userId, items] of byUser) {
    const report = await prisma.report.create({ data: { userId, year: YEAR, weekNum: WEEK } });
    for (const it of items) {
      await prisma.reportItem.create({
        data: {
          reportId: report.id,
          categoryId: it.categoryId,
          currentContents: JSON.stringify(it.current),
          nextContents: JSON.stringify(it.next)
        }
      });
    }
  }

  console.log('적재 완료');
  if (warn.length) { console.log('\n[확인 필요]'); warn.forEach((w) => console.log('  -', w)); }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
