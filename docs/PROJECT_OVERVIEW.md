# 주간보고시스템

## 프로젝트 위치
- 소스코드: `/Users/jayoung/Work/projects/weekly-report/` (구 `C:/AI IDE/Antigravity/`)

## 기술 스택
- **프레임워크**: Next.js 16.2.1 + React 19
- **DB**: PostgreSQL (Supabase) + Prisma ORM
- **인증**: bcryptjs, 역할 기반 (superAdmin / teamMaster / user)
- **배포**: Vercel (icn1 리전), PM2 프로세스 관리
- **언어**: TypeScript

## 주요 구조
```
/Users/jayoung/Work/projects/weekly-report/
├── prisma/schema.prisma        # DB 스키마 (Team, User, Category, Report, ReportItem, SummaryData, SummaryLock)
├── src/app/
│   ├── page.tsx                # 로그인/홈
│   ├── dashboard/page.tsx      # 대시보드 (주차 현황, 캘린더)
│   ├── write/page.tsx          # 주간보고 작성 (드래그앤드롭, undo/redo)
│   ├── summary/page.tsx        # 팀 요약 집계 (팀마스터 뷰)
│   ├── settings/page.tsx       # 설정
│   └── api/
│       ├── auth/               # 로그인, 비밀번호 변경
│       ├── reports/            # 보고서 CRUD, 상태, 요약, 잠금
│       ├── teams/              # 팀 관리
│       ├── users/              # 사용자 관리
│       ├── categories/         # 카테고리 관리
│       └── majors/             # 대분류 관리
├── src/lib/
│   ├── db.ts                   # Prisma 클라이언트
│   ├── auth.ts                 # 권한 검증
│   ├── weekUtils.ts            # 주차 계산
│   ├── UserContext.tsx          # 사용자 세션 컨텍스트
│   ├── useHistory.ts           # undo/redo 훅
│   └── summaryGenerator.ts     # 자동 요약 생성
├── ecosystem.config.js         # PM2 설정
└── vercel.json                 # Vercel 배포 설정
```

## 개발 명령어
```bash
cd "/Users/jayoung/Work/projects/weekly-report"
npm run dev          # 개발 서버
npm run build        # 빌드 (prisma migrate deploy + next build)
npm start            # 프로덕션 서버
npx prisma studio    # DB GUI
npx prisma migrate dev --name <name>  # 마이그레이션 생성
```
