/**
 * 서비스본부 전체 확장 — 로컬 구조/데이터를 운영으로 이관한다.
 *
 *   SOURCE_DATABASE_URL  로컬 (weekly_report_local)
 *   DATABASE_URL         대상 (리허설 DB 또는 운영 Neon)
 *
 * 원칙
 *   - 기획팀·디자인팀은 운영 쪽이 정본이다. 팀 division/orderIdx 외에는 건드리지 않는다.
 *     (분류·유저·role·비밀번호·30주차 보고 전부 그대로 둔다)
 *   - 이름 기준 매핑이라 여러 번 돌려도 안전하다. 이미 있으면 건너뛴다.
 *   - 신규 유저 비밀번호는 NOT_SET (최초 로그인 0000 → 변경 강제).
 *
 * 사용: SOURCE_DATABASE_URL=... DATABASE_URL=... node prisma/deploy_org_to_prod.mjs [--apply]
 *       --apply 없으면 계획만 출력하고 아무것도 쓰지 않는다.
 */
import { PrismaClient } from '@prisma/client';

console.error('LEGACY: 이 스크립트는 2026-08 조직개편 이전 팀명을 사용합니다. 실행하려면 이 블록을 제거하세요.');
process.exit(1);

const APPLY = process.argv.includes('--apply');
const KEEP = ['기획팀', '디자인팀'];   // 운영 정본 — 내용 이관 제외
const YEAR = 2026, WEEK = 30;

const src = new PrismaClient({ datasources: { db: { url: process.env.SOURCE_DATABASE_URL } } });
const dst = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const log = (...a) => console.log(...a);

// ── 1. 소스 읽기 ────────────────────────────────────────────────
const sTeams = await src.team.findMany({
  orderBy: { orderIdx: 'asc' },
  include: {
    parts: { orderBy: { orderIdx: 'asc' }, include: { majorCategories: true, categories: true } },
    userTeams: { include: { user: true } }
  }
});

const sReports = await src.report.findMany({
  where: { year: YEAR, weekNum: WEEK },
  include: {
    user: { include: { team: true } },
    items: { include: { category: { include: { team: true, part: true } } } }
  }
});

// 기획팀·디자인팀 카테고리만 참조하는 보고는 제외 (운영에 이미 있음)
const migrateReports = sReports.filter(r => {
  const teams = [...new Set(r.items.map(i => i.category.team.name))];
  return teams.length > 0 && !teams.every(t => KEEP.includes(t));
});
const skipped = sReports.length - migrateReports.length;

log(`소스: 팀 ${sTeams.length} · 유저 ${new Set(sTeams.flatMap(t => t.userTeams.map(u => u.userId))).size} · ${WEEK}주차 보고 ${sReports.length}`);
log(`이관 대상 보고 ${migrateReports.length}건 (기획/디자인 전용 ${skipped}건 제외)\n`);

// ── 2. 대상 현황 ────────────────────────────────────────────────
const dTeamsBefore = await dst.team.findMany();
const before = {
  teams: dTeamsBefore.length,
  users: await dst.user.count(),
  cats: await dst.category.count(),
  reports: await dst.report.count(),
  items: await dst.reportItem.count()
};
log('대상 현재:', JSON.stringify(before));

if (!APPLY) {
  const newTeams = sTeams.filter(t => !dTeamsBefore.some(d => d.name === t.name));
  log('\n[DRY RUN] 추가될 팀:', newTeams.map(t => t.name).join(', '));
  log('[DRY RUN] --apply 를 붙이면 실제로 반영한다.');
  await src.$disconnect(); await dst.$disconnect();
  process.exit(0);
}

// ── 3. 이관 ─────────────────────────────────────────────────────
const stat = { team: 0, teamUpd: 0, part: 0, major: 0, cat: 0, user: 0, userTeam: 0, report: 0, item: 0 };
const catMap = new Map();   // `${team}|${part}|${major}|${middle}` → 대상 categoryId
const userMap = new Map();  // `${team}|${name}` → 대상 userId

await dst.$transaction(async (tx) => {
  // 3-1. 팀
  for (const t of sTeams) {
    const exist = await tx.team.findUnique({ where: { name: t.name } });
    if (exist) {
      // 기존 팀은 구분/정렬만 맞춘다
      if (exist.division !== t.division || exist.orderIdx !== t.orderIdx) {
        await tx.team.update({ where: { id: exist.id }, data: { division: t.division, orderIdx: t.orderIdx } });
        stat.teamUpd++;
      }
    } else {
      await tx.team.create({ data: { name: t.name, division: t.division, orderIdx: t.orderIdx } });
      stat.team++;
    }
  }

  // 3-2. 분류 (기존 팀은 운영 정본이므로 건너뛴다)
  for (const t of sTeams) {
    const dTeam = await tx.team.findUnique({ where: { name: t.name } });
    if (KEEP.includes(t.name)) {
      // 매핑만 채운다 — 보고 이관에서 쓰지 않지만 안전하게
      const dParts = await tx.part.findMany({ where: { teamId: dTeam.id }, include: { categories: true } });
      dParts.forEach(p => p.categories.forEach(c =>
        catMap.set(`${t.name}|${p.name}|${c.major}|${c.middle}`, c.id)));
      continue;
    }
    for (const p of t.parts) {
      const dPart = await tx.part.upsert({
        where: { teamId_name: { teamId: dTeam.id, name: p.name } },
        update: { orderIdx: p.orderIdx, isActive: p.isActive },
        create: { name: p.name, teamId: dTeam.id, orderIdx: p.orderIdx, isActive: p.isActive }
      });
      stat.part++;
      for (const m of p.majorCategories) {
        await tx.majorCategory.upsert({
          where: { partId_name: { partId: dPart.id, name: m.name } },
          update: { orderIdx: m.orderIdx, isActive: m.isActive },
          create: { name: m.name, teamId: dTeam.id, partId: dPart.id, orderIdx: m.orderIdx, isActive: m.isActive }
        });
        stat.major++;
      }
      for (const c of p.categories) {
        const dCat = await tx.category.upsert({
          where: { partId_major_middle: { partId: dPart.id, major: c.major, middle: c.middle } },
          update: { orderIdx: c.orderIdx, isActive: c.isActive },
          create: { major: c.major, middle: c.middle, teamId: dTeam.id, partId: dPart.id, orderIdx: c.orderIdx, isActive: c.isActive }
        });
        catMap.set(`${t.name}|${p.name}|${c.major}|${c.middle}`, dCat.id);
        stat.cat++;
      }
    }
  }

  // 3-3. 유저 (주 소속 기준 생성 → 겸직 관계)
  for (const t of sTeams) {
    const dTeam = await tx.team.findUnique({ where: { name: t.name } });
    for (const ut of t.userTeams) {
      if (!ut.isPrimary) continue;                       // 주 소속에서만 생성
      const u = ut.user;
      const exist = await tx.user.findUnique({ where: { teamId_name: { teamId: dTeam.id, name: u.name } } });
      if (exist) {
        userMap.set(`${t.name}|${u.name}`, exist.id);    // 기존 유저: role·비번 그대로 둔다
      } else {
        const created = await tx.user.create({
          data: {
            name: u.name, teamId: dTeam.id, role: u.role, position: u.position,
            password: 'NOT_SET', mustChangePw: true, isActive: u.isActive
          }
        });
        userMap.set(`${t.name}|${u.name}`, created.id);
        stat.user++;
      }
    }
  }
  // 주 소속이 없는 유저 대비 (전원 주 소속이 있어야 정상)
  for (const t of sTeams) {
    for (const ut of t.userTeams) {
      const key = `${ut.user.team?.name ?? ''}|${ut.user.name}`;
      if (!ut.isPrimary && !userMap.has(key)) {
        const primaryTeam = sTeams.find(x => x.id === ut.user.teamId);
        if (!primaryTeam) throw new Error(`주 소속 팀을 찾을 수 없음: ${ut.user.name}`);
      }
    }
  }

  // 3-4. 겸직 관계
  for (const t of sTeams) {
    const dTeam = await tx.team.findUnique({ where: { name: t.name } });
    for (const ut of t.userTeams) {
      const primaryTeamName = sTeams.find(x => x.id === ut.user.teamId)?.name;
      const uid = userMap.get(`${primaryTeamName}|${ut.user.name}`);
      if (!uid) throw new Error(`유저 매핑 실패: ${ut.user.name} (주 소속 ${primaryTeamName})`);
      const r = await tx.userTeam.upsert({
        where: { userId_teamId: { userId: uid, teamId: dTeam.id } },
        update: { isPrimary: ut.isPrimary },
        create: { userId: uid, teamId: dTeam.id, isPrimary: ut.isPrimary }
      });
      if (r) stat.userTeam++;
    }
  }

  // 3-5. 30주차 보고
  for (const r of migrateReports) {
    const primaryTeamName = sTeams.find(x => x.id === r.user.teamId)?.name;
    const uid = userMap.get(`${primaryTeamName}|${r.user.name}`);
    if (!uid) throw new Error(`보고 작성자 매핑 실패: ${r.user.name}`);

    const dup = await tx.report.findUnique({ where: { userId_year_weekNum: { userId: uid, year: YEAR, weekNum: WEEK } } });
    if (dup) continue;   // 재실행 안전

    const rep = await tx.report.create({ data: { userId: uid, year: YEAR, weekNum: WEEK } });
    stat.report++;

    for (const it of r.items) {
      const key = `${it.category.team.name}|${it.category.part.name}|${it.category.major}|${it.category.middle}`;
      const cid = catMap.get(key);
      if (!cid) throw new Error(`분류 매핑 실패: ${key}`);
      await tx.reportItem.create({
        data: { reportId: rep.id, categoryId: cid, currentContents: it.currentContents, nextContents: it.nextContents }
      });
      stat.item++;
    }
    // 작성 시각을 소스 값으로 맞춘다 (@updatedAt 이라 create 로는 지정되지 않는다)
    await tx.$executeRaw`UPDATE "Report" SET "createdAt"=${r.createdAt}, "updatedAt"=${r.updatedAt} WHERE id=${rep.id}`;
  }
}, { timeout: 180000, maxWait: 20000 });

// ── 4. 검증 ─────────────────────────────────────────────────────
const after = {
  teams: await dst.team.count(),
  users: await dst.user.count(),
  cats: await dst.category.count(),
  reports: await dst.report.count(),
  items: await dst.reportItem.count()
};
log('\n반영:', JSON.stringify(stat));
log('대상 이후:', JSON.stringify(after));

// 기존 두 팀 불변 확인
for (const nm of KEEP) {
  const t = await dst.team.findUnique({ where: { name: nm } });
  const cats = await dst.category.count({ where: { teamId: t.id } });
  const items = await dst.reportItem.count({ where: { category: { teamId: t.id } } });
  const users = await dst.user.count({ where: { teamId: t.id } });
  log(`  ${nm}: 유저 ${users} · 분류 ${cats} · 아이템 ${items}`);
}

await src.$disconnect();
await dst.$disconnect();
