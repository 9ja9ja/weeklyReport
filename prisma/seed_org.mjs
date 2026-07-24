/**
 * 서비스본부 조직/분류 시드
 *
 * 출처: 상세본_서비스본부_주간_보고_2026년_30주차.docx
 * 계층 매핑: 구분 → Team.division / 분류1 → Part / 분류2 → MajorCategory / ⑴ → Category.middle
 *
 * 실행: DATABASE_URL="postgresql://..." node prisma/seed_org.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 문서에 분류2(대분류)가 없는 경우 파트명을 그대로 대분류로 쓴다.
const SAME = Symbol('same-as-part');

const TEAMS = [
  // ─────────────────────────── Pharos ───────────────────────────
  {
    name: '기획팀',
    division: 'Pharos',
    members: [
      { name: '구자영', position: '매니저', role: 'superAdmin' },
      { name: '방수진', position: '매니저' },
      { name: '허주희', position: '매니저' },
      { name: '윤난희', position: '매니저' },
      { name: '박종민', position: '매니저' },
      { name: '신지희', position: '매니저' },
    ],
    parts: [
      {
        name: '기획',
        majors: [
          { name: '서비스', middles: ['근태관리', '전자계약', '전자결재', 'Anchor', '인사이드뱅크'] },
          { name: '제휴', middles: ['AT, 한국공인회계사회', '삼일회계법인', '하이웍스'] },
          { name: '운영', middles: ['VOC 상시 대응', '세법 변경', 'BackOffice'] },
        ],
      },
    ],
  },
  {
    name: '디자인팀',
    division: 'Pharos',
    members: [
      { name: '이세라', position: '매니저' },
      { name: '유미진', position: '매니저' },
    ],
    parts: [
      {
        name: '디자인',
        majors: [
          {
            name: SAME,
            middles: ['Pharos / Stella', 'Anchor', '마케팅 디자인', '핑거 전사 디자인'],
          },
        ],
      },
    ],
  },
  {
    name: '파로스 개발팀',
    division: 'Pharos',
    members: [
      { name: '손규호', position: '팀장/마스터', role: 'teamMaster' },
      { name: '이재민', position: '부팀장/매니저' },
      { name: '조성운', position: '마스터' },
      { name: '신재현', position: '매니저' },
      { name: '최연정', position: '매니저' },
      { name: '이다영', position: '매니저' },
      { name: '양병석', position: '매니저' },
      { name: '김아림', position: '매니저' },
      { name: '김소영', position: '매니저' },
      { name: '이영석', position: '매니저' },
      { name: '김수현', position: '매니저' },
      { name: '조혜민', position: '매니저' },
      { name: '윤상원', position: '매니저' },
      { name: '박한우', position: '매니저' },
      { name: '윤호준', position: '프로' },
      { name: '송기영', position: '프로' },
      { name: '임재희', position: '프로' },
    ],
    parts: [
      {
        name: '개발',
        majors: [
          {
            name: '서비스',
            middles: [
              '파로스 근태관리',
              '공통',
              'Anchor',
              '지방소득세',
              'AT',
              '팝빌 라우터',
              '전자결재',
              '부가세 26년 7월 개정사항',
              'VOC 대응',
              '어카운팅 인사이트',
              '파로스 홈페이지 컨텐츠 업데이트',
            ],
          },
          { name: '제휴', middles: [] },
          { name: '운영', middles: ['Pharos(Stella) 개선 및 VOC 반영', '기타 개선 및 VOC 반영'] },
          { name: '고도화', middles: ['Pharos 고도화 진행 경과'] },
        ],
      },
    ],
  },

  // ──────────────────────────── 개발 ────────────────────────────
  {
    name: 'BIG팀',
    division: '개발',
    members: [
      { name: '최호식', position: '팀장/마스터', role: 'teamMaster' },
      { name: '성하석', position: '매니저' },
      { name: '김준기', position: '매니저' },
      { name: '방정은', position: '매니저' },
      { name: '심상우', position: '매니저' },
      { name: '김인수', position: '매니저' },
      { name: '이은송', position: '프로' },
      { name: '홍성빈', position: '프로' },
    ],
    parts: [
      {
        name: '내부',
        majors: [
          {
            name: 'BIG',
            middles: [
              'Engine 및 서버',
              'Script',
              '사이트 점검 및 오류 공지',
              '저축은행',
              'FingerCM 리뉴얼',
              '홈택스 EverSafe 대응',
              'FSWS 취약점 대응',
            ],
          },
          { name: 'BIG-S', middles: [] },
          { name: 'Pharos', middles: ['문의 대응'] },
          { name: 'Forest', middles: [] },
          { name: 'FingerCM', middles: ['삼일회계법인'] },
          { name: 'FingerTM', middles: [] },
          { name: '신한전자세금계산서', middles: [] },
          { name: 'ACAMS', middles: [] },
          { name: '오케스트라', middles: [] },
        ],
      },
      {
        name: '핀테크',
        majors: [
          { name: '카카오뱅크', middles: ['오류문의 대응', 'Mobile'] },
          { name: '콕뱅크', middles: ['문의 대응'] },
          { name: '파피노스', middles: [] },
          { name: '서버 스크래핑', middles: [] },
          { name: '스크래핑 중계', middles: [] },
        ],
      },
      {
        name: '신한은행',
        majors: [
          { name: 'Insidebank', middles: ['문의 대응', '이체 스크립트 교체 작업'] },
          { name: 'Web CMS', middles: ['문의 대응', 'FSWS 버전 교체'] },
          { name: '서버 스크래핑', middles: [] },
          { name: '신한 PDF변환', middles: [] },
          { name: '땡겨요', middles: [] },
          { name: 'SOL & SOL_BIZ', middles: [] },
          { name: '신규개발건', middles: [] },
        ],
      },
      {
        name: '하나은행',
        majors: [
          { name: '하나원큐', middles: ['모바일웹 서버스크래핑 도입건', '군 장병 급여계좌변경'] },
        ],
      },
      {
        name: '제주은행',
        majors: [
          { name: '제주개발공사', middles: ['펌뱅킹'] },
          { name: '제주관광공사', middles: ['서버교체 준비'] },
          { name: '제주 연구원', middles: ['지급 이체 오류'] },
          { name: '제주 테크노파크', middles: [] },
        ],
      },
      { name: 'KTNET', majors: [{ name: SAME, middles: ['문의 대응'] }] },
      { name: '신한카드', majors: [{ name: '연구비', middles: ['문의 대응'] }] },
      { name: '기업은행', majors: [{ name: 'i-One Bank', middles: ['Mobile'] }] },
      { name: '신한라이프', majors: [{ name: SAME, middles: ['건강보험'] }] },
      { name: '케이뱅크', majors: [{ name: '케이뱅크', middles: ['오류문의 대응'] }] },
      { name: '서울신용보증보험', majors: [{ name: SAME, middles: [] }] },
      { name: '경기신용보증보험', majors: [{ name: SAME, middles: ['도입문의 대응'] }] },
      { name: '신한DS', majors: [{ name: '신한DS', middles: ['문의 대응'] }] },
    ],
  },

  // ──────────────────────────── 영업 ────────────────────────────
  {
    name: '영업팀',
    division: '영업',
    members: [],
    parts: [
      {
        name: '제주은행',
        majors: [
          {
            name: SAME,
            middles: [
              '제주CMS 아마란스10 ERP 변경 개발',
              '제주CMS 신규 은행 추가 펌뱅킹 연계 개발',
            ],
          },
        ],
      },
      {
        name: '기업은행',
        majors: [
          {
            name: SAME,
            middles: ['모바일 스크래핑 모듈 추가 도입 및 계약 갱신', '금융/간편 인증서 연동 개발'],
          },
        ],
      },
      {
        name: '신한은행',
        majors: [{ name: SAME, middles: ['공공 마이데이터 웹문서변환 도입'] }],
      },
      {
        name: '신한라이프',
        majors: [
          {
            name: SAME,
            middles: [
              '건강보험공단 모바일 스크래핑 모듈 도입',
              '건강보험심사평가원 및 건강보험공단 모바일 스크래핑 추가 도입',
            ],
          },
        ],
      },
      {
        name: '경기신용보증재단',
        majors: [{ name: SAME, middles: ['홈택스 PC/모바일 스크래핑 솔루션 도입'] }],
      },
    ],
  },

  // ─────────────────────────── 마케팅 ───────────────────────────
  {
    name: '파로스 마케팅',
    division: '마케팅',
    members: [
      { name: '박상희', position: '매니저' },
      { name: '박소정', position: '매니저' },
      { name: '최은우', position: '매니저' },
    ],
    parts: [
      {
        name: '내부',
        majors: [
          {
            name: '전략',
            middles: ['파로스&스텔라 - 광고', '파로스&스텔라 - 홍보', '업데이트', '기타'],
          },
          {
            name: '서비스 관리',
            middles: [
              'CMS출금등록 및 하이웍스 유료고객 현황',
              '세금신고서 작성 현황',
              '파로스 채널톡 검토',
            ],
          },
        ],
      },
    ],
  },
  {
    name: '파로스 제휴',
    division: '마케팅',
    members: [
      { name: '황충근', position: '매니저' },
      { name: '성왕선', position: '매니저' },
      { name: '김규필', position: '매니저' },
    ],
    parts: [
      {
        name: '제휴',
        majors: [
          { name: '하나펀드서비스', middles: ['Stella 사업 제휴'] },
          { name: 'AML-HUB', middles: ['ACAMS 프로그램 신청 현황'] },
          { name: '삼일회계법인', middles: ['책무구조관리시스템 사업 추진'] },
          { name: '한국공인회계사협회', middles: ['AT자격시험 병행 실기프로그램 도입 사업'] },
          { name: '나이스평가정보', middles: ['비즈파로스 제휴 사업 추진'] },
          { name: '가비아', middles: ['하이웍스파로스 공동 사업 추진'] },
        ],
      },
    ],
  },

  // ──────────────────────────── 운영 ────────────────────────────
  {
    name: '파로스 CRM',
    division: '운영',
    members: [
      { name: '김민서', position: '매니저' },
      { name: '이민영', position: '매니저' },
      { name: '허예지', position: '매니저' },
      { name: '김성연', position: '매니저' },
      { name: '지아연', position: '매니저' },
    ],
    parts: [
      {
        name: '핑거',
        majors: [
          {
            name: 'Pharos',
            middles: [
              '서비스 정산',
              '고객 지원',
              'Pharos, Stella 통합 테스트 및 운영서버 반영 확인',
              '매뉴얼 및 공지',
              '업데이트 내역 작성 및 검수',
              '채널별 회원가입현황',
              'CMS등록현황',
              '이용권 해지상세',
              '문의 현황',
              '매출현황',
            ],
          },
          { name: 'BIG', middles: ['운영 실적'] },
        ],
      },
    ],
  },
  {
    name: '땡겨요',
    division: '운영',
    members: [],
    parts: [
      {
        name: '땡겨요 사업단',
        majors: [{ name: '전자계약 임금명세서', middles: ['환불 진행 경과'] }],
      },
    ],
  },
  {
    name: 'CMS팀',
    division: '운영',
    members: [
      { name: '강경오', position: '매니저' },
      { name: '김은진', position: '매니저' },
      { name: '장용석', position: '매니저' },
      { name: '김진혁', position: '프로' },
      { name: '고경식', position: '매니저' },
      { name: '안정환', position: '매니저' },
      { name: '조학래', position: '매니저' },
      { name: '김민', position: '매니저' },
      { name: '전창현', position: '매니저' },
      { name: '이선형', position: '매니저' },
      { name: '김은경', position: '프로' },
      { name: '이종철', position: '프로' },
    ],
    parts: [
      {
        name: '기업디지털 전담반',
        majors: [
          {
            name: '관리/기획/영업',
            middles: [
              '자체 사업',
              '신한은행 신규서비스 검토',
              '인사이드뱅크 프로모션 대응',
              '공급망지급결제플랫폼 구축 프로젝트',
            ],
          },
          {
            name: 'Insidebank & Mizuho Smart',
            middles: ['고객 현황', '서비스 개선 검토 및 개발', '마케팅 및 방문'],
          },
          {
            name: '뱅크인플랫폼',
            middles: ['고객 현황', '결함/개선 사항 검토 및 개발', '제휴사 방문'],
          },
          { name: 'Web CMS', middles: ['운영 실적', '결함/개선 사항 검토 및 수정 개발'] },
          { name: 'SOL-Biz', middles: ['운영 실적', 'New SOL-Biz 안정화 진행'] },
          { name: 'SOHO Mate', middles: ['운영 실적', '운영 모니터링'] },
        ],
      },
    ],
  },

  // ───────────────────────────── PMO ────────────────────────────
  {
    name: 'PMO',
    division: 'PMO',
    members: [{ name: '임수비', position: '매니저' }],
    parts: [{ name: 'PMO', majors: [{ name: SAME, middles: ['계약관리', '사업관리'] }] }],
  },
];

/**
 * 겸직 — 주 소속팀 외에 작성 권한이 필요한 팀
 * 30주차 문서의 담당자 표기를 조직도와 대조해 도출
 */
const CROSS_TEAM = [
  // 파로스 개발팀 인원이 BIG팀(개발 구분) 항목을 담당
  { name: '이재민', teams: ['BIG팀'] }, // 내부 > BIG-S
  { name: '박한우', teams: ['BIG팀'] }, // 내부 > BIG-S
  { name: '윤호준', teams: ['BIG팀'] }, // 내부 > BIG-S
  { name: '최연정', teams: ['BIG팀'] }, // 내부 > Forest
  { name: '양병석', teams: ['BIG팀'] }, // 내부 > Forest, 핀테크 > 스크래핑 중계
  { name: '조성운', teams: ['BIG팀'] }, // 내부 > 신한전자세금계산서, 제주은행 전체
  { name: '김수현', teams: ['BIG팀'] }, // 내부 > ACAMS

  // 영업 구분은 전원 타 팀 겸직
  { name: '최호식', teams: ['영업팀'] },
  { name: '황충근', teams: ['영업팀', '파로스 마케팅'] }, // 마케팅 > 내부 > 서비스 관리
  { name: '김규필', teams: ['영업팀'] },

  // 운영 구분
  { name: '허예지', teams: ['땡겨요'] },
  { name: '지아연', teams: ['땡겨요'] },
];

async function main() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    console.log('[reset] 기존 조직/분류 데이터 삭제');
    await prisma.reportItem.deleteMany({});
    await prisma.report.deleteMany({});
    await prisma.summaryData.deleteMany({});
    await prisma.summaryLock.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.majorCategory.deleteMany({});
    await prisma.part.deleteMany({});
    await prisma.userTeam.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.team.deleteMany({});
  }

  const teamIdByName = new Map();
  const userIdByName = new Map();
  const stats = { teams: 0, users: 0, parts: 0, majors: 0, categories: 0, links: 0 };

  for (const [ti, t] of TEAMS.entries()) {
    const team = await prisma.team.upsert({
      where: { name: t.name },
      update: { division: t.division, orderIdx: ti },
      create: { name: t.name, division: t.division, orderIdx: ti },
    });
    teamIdByName.set(t.name, team.id);
    stats.teams++;

    for (const m of t.members) {
      const user = await prisma.user.upsert({
        where: { teamId_name: { teamId: team.id, name: m.name } },
        update: { position: m.position ?? '', role: m.role ?? 'user' },
        create: {
          name: m.name,
          teamId: team.id,
          position: m.position ?? '',
          role: m.role ?? 'user',
        },
      });
      userIdByName.set(m.name, user.id);
      stats.users++;

      await prisma.userTeam.upsert({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
        update: { isPrimary: true },
        create: { userId: user.id, teamId: team.id, isPrimary: true },
      });
      stats.links++;
    }

    for (const [pi, p] of t.parts.entries()) {
      const part = await prisma.part.upsert({
        where: { teamId_name: { teamId: team.id, name: p.name } },
        update: { orderIdx: pi },
        create: { name: p.name, teamId: team.id, orderIdx: pi },
      });
      stats.parts++;

      for (const [mi, mj] of p.majors.entries()) {
        const majorName = mj.name === SAME ? p.name : mj.name;

        await prisma.majorCategory.upsert({
          where: { partId_name: { partId: part.id, name: majorName } },
          update: { orderIdx: mi, teamId: team.id },
          create: { name: majorName, partId: part.id, teamId: team.id, orderIdx: mi },
        });
        stats.majors++;

        for (const [ci, middle] of mj.middles.entries()) {
          await prisma.category.upsert({
            where: {
              partId_major_middle: { partId: part.id, major: majorName, middle },
            },
            update: { orderIdx: ci, teamId: team.id },
            create: {
              major: majorName,
              middle,
              partId: part.id,
              teamId: team.id,
              orderIdx: ci,
            },
          });
          stats.categories++;
        }
      }
    }
  }

  for (const c of CROSS_TEAM) {
    const userId = userIdByName.get(c.name);
    if (!userId) {
      console.warn(`  [경고] 겸직 대상 '${c.name}' 계정 없음 — 건너뜀`);
      continue;
    }
    for (const teamName of c.teams) {
      const teamId = teamIdByName.get(teamName);
      if (!teamId) {
        console.warn(`  [경고] 겸직 팀 '${teamName}' 없음 — 건너뜀`);
        continue;
      }
      await prisma.userTeam.upsert({
        where: { userId_teamId: { userId, teamId } },
        update: {},
        create: { userId, teamId, isPrimary: false },
      });
      stats.links++;
    }
  }

  console.log('\n시드 완료');
  console.log(`  팀        ${stats.teams}`);
  console.log(`  팀원      ${stats.users}`);
  console.log(`  파트      ${stats.parts}`);
  console.log(`  대분류    ${stats.majors}`);
  console.log(`  중분류    ${stats.categories}`);
  console.log(`  소속연결  ${stats.links}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
