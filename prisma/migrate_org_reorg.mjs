/**
 * 조직개편 마이그레이션 — 팀 이름·구분·정렬 일괄 변경
 *
 * 사용:
 *   DATABASE_URL="..." node prisma/migrate_org_reorg.mjs            # dry-run (변경 내용만 출력)
 *   DATABASE_URL="..." node prisma/migrate_org_reorg.mjs --apply    # 실행
 *   DATABASE_URL="..." node prisma/migrate_org_reorg.mjs --rollback          # 역변환 dry-run
 *   DATABASE_URL="..." node prisma/migrate_org_reorg.mjs --rollback --apply  # 역변환 실행
 *
 * 원칙:
 *   - Team.name / division / orderIdx 만 변경한다. FK(users, parts 등)는 id 기반이라 영향 없다.
 *   - interactive transaction 안에서 사전·사후 검증을 수행하고 실패 시 전체 롤백한다.
 */
import { PrismaClient } from '@prisma/client';

// ── 플래그 ─────────────────────────────────────────────────────
const APPLY    = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

// ── 매핑: [id, 기존이름, 변경이름, 변경division, 변경orderIdx] ──
const RENAME_MAP = [
  [4,  '서비스본부',    '비즈니스플랫폼본부', '임원', 0],
  [1,  '기획팀',        '플랫폼기획팀',       '',     1],
  [5,  '파로스 개발팀', '플랫폼개발팀',       '',     4],
  [6,  'BIG팀',         '데이터서비스팀',     '',     5],
  [7,  '파로스 마케팅', '플랫폼사업 마케팅',  '',     3],
  [8,  '비즈니스팀',    '플랫폼사업',         '',     2],
  [9,  '파로스 CRM',    'CRM팀',             '',     6],
  [10, '땡겨요',        '땡겨요',             '',     8],
  [11, 'CMS팀',         '기업금융서비스팀',   '',     7],
  [12, 'PMO',           'PMO',               '',     9],
];

const ROLLBACK_MAP = [
  [4,  '비즈니스플랫폼본부', '서비스본부',    '임원',     0],
  [1,  '플랫폼기획팀',       '기획팀',        'Pharos',   1],
  [5,  '플랫폼개발팀',       '파로스 개발팀', 'Pharos',   2],
  [6,  '데이터서비스팀',     'BIG팀',         '개발',     3],
  [7,  '플랫폼사업 마케팅',  '파로스 마케팅', '마케팅',   4],
  [8,  '플랫폼사업',         '비즈니스팀',    '비즈니스', 5],
  [9,  'CRM팀',             '파로스 CRM',    '운영',     6],
  [10, '땡겨요',             '땡겨요',        '운영',     7],
  [11, '기업금융서비스팀',   'CMS팀',         '운영',     8],
  [12, 'PMO',               'PMO',           'PMO',      9],
];

const MAP = ROLLBACK ? ROLLBACK_MAP : RENAME_MAP;
const MODE = ROLLBACK ? '역변환(rollback)' : '정변환(forward)';

const log = (...a) => console.log(...a);
const prisma = new PrismaClient();

try {
  log(`\n=== 조직개편 마이그레이션 [${MODE}] ${APPLY ? '** 실행 **' : '(dry-run)'} ===\n`);

  // ── 1. 사전 검증 ──────────────────────────────────────────────
  log('--- 사전 검증 ---');
  const errors = [];

  // 1-a. id -> 기존 팀명 일치 확인
  for (const [id, oldName] of MAP) {
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) {
      errors.push(`id=${id}: 팀이 존재하지 않음 (기대: "${oldName}")`);
    } else if (team.name !== oldName) {
      errors.push(`id=${id}: 현재 이름 "${team.name}" !== 기대 이름 "${oldName}"`);
    }
  }

  // 1-b. 변경 후 이름 충돌 검사
  //   - MAP에 포함된 팀들의 변경 후 이름끼리 충돌
  const newNames = MAP.map(([, , newName]) => newName);
  const dupNew = newNames.filter((n, i) => newNames.indexOf(n) !== i);
  if (dupNew.length > 0) {
    errors.push(`변경 후 이름 중복: ${[...new Set(dupNew)].join(', ')}`);
  }
  //   - MAP에 포함되지 않은 기존 팀과 충돌
  const mapIds = new Set(MAP.map(([id]) => id));
  const allTeams = await prisma.team.findMany();
  const outsideTeams = allTeams.filter(t => !mapIds.has(t.id));
  for (const [id, , newName] of MAP) {
    const conflict = outsideTeams.find(t => t.name === newName);
    if (conflict) {
      errors.push(`id=${id}: 변경 후 이름 "${newName}"이 기존 팀 id=${conflict.id}과 충돌`);
    }
  }

  if (errors.length > 0) {
    log('\n사전 검증 실패:');
    errors.forEach(e => log(`  - ${e}`));
    process.exit(1);
  }
  log('사전 검증 통과\n');

  // ── 2. 변경 내역 출력 ─────────────────────────────────────────
  log('--- 변경 계획 ---');
  // FK 카운트 스냅샷 (사전)
  const preSnap = new Map();
  for (const [id, oldName, newName, newDiv, newOrd] of MAP) {
    const team = await prisma.team.findUnique({ where: { id } });
    const userCount = await prisma.user.count({ where: { teamId: id } });
    const partCount = await prisma.part.count({ where: { teamId: id } });
    preSnap.set(id, { userCount, partCount });

    const nameChange = oldName !== newName ? `"${oldName}" -> "${newName}"` : `"${oldName}" (변경없음)`;
    const divChange = team.division !== newDiv ? `"${team.division}" -> "${newDiv}"` : `"${team.division}" (변경없음)`;
    const ordChange = team.orderIdx !== newOrd ? `${team.orderIdx} -> ${newOrd}` : `${team.orderIdx} (변경없음)`;
    log(`  id=${id}: ${nameChange} | division: ${divChange} | orderIdx: ${ordChange} | users=${userCount}, parts=${partCount}`);
  }

  if (!APPLY) {
    log(`\n[DRY RUN] --apply 를 붙이면 실제로 반영한다.\n`);
    process.exit(0);
  }

  // ── 3. 트랜잭션 실행 ──────────────────────────────────────────
  log('\n--- 트랜잭션 실행 ---');
  await prisma.$transaction(async (tx) => {
    // 이름 충돌 방지를 위해 임시 이름으로 먼저 변경한 뒤 최종 이름으로 다시 변경한다.
    // (예: A->B, B->A 교차 변경 시 unique 제약 위반 방지)
    const TEMP_PREFIX = '__migrate_tmp_';

    // 3-1. 임시 이름으로 변경
    for (const [id] of MAP) {
      await tx.team.update({
        where: { id },
        data: { name: `${TEMP_PREFIX}${id}` },
      });
    }

    // 3-2. 최종 이름·division·orderIdx 변경
    for (const [id, , newName, newDiv, newOrd] of MAP) {
      await tx.team.update({
        where: { id },
        data: { name: newName, division: newDiv, orderIdx: newOrd },
      });
    }

    // ── 사후 검증 (트랜잭션 내부) ────────────────────────────────
    log('\n--- 사후 검증 ---');
    const postErrors = [];

    for (const [id, , newName, newDiv, newOrd] of MAP) {
      const team = await tx.team.findUnique({ where: { id } });

      // 이름 확인
      if (team.name !== newName) {
        postErrors.push(`id=${id}: 이름 "${team.name}" !== 기대 "${newName}"`);
      }
      // division 확인
      if (team.division !== newDiv) {
        postErrors.push(`id=${id}: division "${team.division}" !== 기대 "${newDiv}"`);
      }
      // orderIdx 확인
      if (team.orderIdx !== newOrd) {
        postErrors.push(`id=${id}: orderIdx ${team.orderIdx} !== 기대 ${newOrd}`);
      }

      // FK 개수 보존 확인
      const userCount = await tx.user.count({ where: { teamId: id } });
      const partCount = await tx.part.count({ where: { teamId: id } });
      const pre = preSnap.get(id);

      if (userCount !== pre.userCount) {
        postErrors.push(`id=${id}: users 수 변경 ${pre.userCount} -> ${userCount}`);
      }
      if (partCount !== pre.partCount) {
        postErrors.push(`id=${id}: parts 수 변경 ${pre.partCount} -> ${partCount}`);
      }
    }

    if (postErrors.length > 0) {
      log('사후 검증 실패 (트랜잭션 롤백):');
      postErrors.forEach(e => log(`  - ${e}`));
      throw new Error('사후 검증 실패 - 트랜잭션 롤백');
    }

    log('사후 검증 통과');
  }, { timeout: 60000, maxWait: 10000 });

  // ── 4. 최종 결과 출력 ─────────────────────────────────────────
  log('\n--- 최종 결과 ---');
  const finalTeams = await prisma.team.findMany({
    where: { id: { in: MAP.map(([id]) => id) } },
    orderBy: { orderIdx: 'asc' },
  });
  for (const t of finalTeams) {
    const userCount = await prisma.user.count({ where: { teamId: t.id } });
    const partCount = await prisma.part.count({ where: { teamId: t.id } });
    log(`  id=${t.id}: "${t.name}" | division="${t.division}" | orderIdx=${t.orderIdx} | users=${userCount}, parts=${partCount}`);
  }
  log('\n마이그레이션 완료.\n');

} catch (err) {
  if (err.message === '사후 검증 실패 - 트랜잭션 롤백') {
    log('\n트랜잭션이 롤백되었다. DB는 변경 전 상태이다.\n');
  } else {
    console.error('\n오류 발생:', err);
  }
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
