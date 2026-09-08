# 주간보고 시스템 이관 계획서

비즈니스플랫폼본부 주간보고 — Vercel + GitHub -> 사내 GitLab + Jenkins + 사내 클라우드

작성일: 2026-09-08 · 대상 저장소: `weeklyReport` · 운영 도메인: `service-weekly.fingerservice.co.kr`

> 튜토리얼(파로스/스텔라) 이관은 스택과 난이도가 완전히 달라 별도 계획서로 분리했다.
> -> `pharos-demo/docs/migration/README.md`

---

## 1. 요약 — 튜토리얼과 난이도가 다릅니다

| | 튜토리얼 | **주간보고** |
|---|---|---|
| 스택 | 정적 HTML/JS | **Next.js 16 + React 19 + Prisma + PostgreSQL** |
| 빌드 | 없음 | `prisma migrate deploy && next build` |
| 런타임 | 불필요 | **Node 프로세스 상시 구동** |
| 상태 | 없음 | **DB + 실시간 협업 문서(Yjs)** |
| 도메인 연결 | nginx 리버스프록시 (이미 사내 서버 경유) | **Vercel DNS 직결 -> DNS 변경 필요** |
| 환경변수 | 0개 | **16개, 대부분 시크릿** |
| 외부 인프라 | 없음 | **Cloudflare Workers + Durable Objects** |
| 무중단 배포 | 심볼릭 링크 전환 | 프로세스 재시작 필요 -> 별도 설계 |
| 난이도 | 낮음 | **높음** |

**가장 먼저 정해야 할 것**: 실시간 협업 서버(Cloudflare Worker)를 옮길 것인가, 남길 것인가.
이 결정이 전체 일정과 난이도를 가른다 (4장).

---

## 2. 현황 — 3계층 구조

```
                    service-weekly.fingerservice.co.kr
                              | (CNAME -> vercel-dns-017.com : Vercel 직결)
                              v
        +---------------------------------------+
        |  Next.js 앱 (Vercel, region icn1)      |
        |   - 화면/API/인증(자체 세션+bcrypt)      |
        |   - Prisma -> PostgreSQL               |
        |   - Google Drive 내보내기                |
        +---------------------------------------+
             ^                          |
   HMAC 서명 fetch                  Prisma
   (REALTIME_SERVER_SECRET)            |
             |                          v
        +---------------------------+  +----------------------+
        | Cloudflare Worker         |  | PostgreSQL           |
        | weekly-report-realtime    |  | ** 사내 이관 완료 **   |
        |  - Durable Objects(SQLite)|  +----------------------+
        |  - y-partyserver / Yjs    |
        |  - WebSocket Hibernation  |
        +---------------------------+
                   ^
                   | WebSocket (공동편집)
                브라우저
```

### 확인된 사실
| 항목 | 내용 |
|---|---|
| 프레임워크 | Next.js 16.2.1 / React 19.2.4 (App Router) |
| ORM/DB | Prisma 5.21.1 / PostgreSQL — **DB 는 이미 사내로 이관 완료** |
| 마이그레이션 | 21개 (최신 `20260814083211_fix_writing_excuse_cascade`) |
| 인증 | 자체 세션(`SESSION_SECRET`) + bcryptjs. 외부 IdP 없음 |
| 실시간 | Cloudflare Workers + Durable Objects(SQLite 백엔드), y-partyserver 2.2.0, TipTap |
| 소스 규모 | `src` 138 파일 / 1.4MB, `party` 56KB |
| 테스트 | vitest, 테스트 파일 34개 (`test:db` 는 로컬 PostgreSQL 55432 필요) |
| 저장소 | github.com/9ja9ja/weeklyReport — 커밋 99개, 브랜치 10개, `.git` 10MB, **Actions 없음** |
| Vercel cron | `/api/health` 3일마다 (`CRON_SECRET` Bearer 인증, DB `SELECT 1`) |

### 자체 호스팅에 유리한 점 (조사 결과)
- **Edge 런타임 미사용** — 전부 Node 런타임
- **ISR / `revalidate` 미사용** — 공유 캐시 스토리지 불필요
- **`next/image` 미사용** — sharp 설치·이미지 최적화 서버 불필요
- **Vercel KV/Blob/Postgres 등 Vercel 전용 서비스 미사용**

-> Vercel 종속성이 생각보다 얕다. 진짜 장벽은 **Cloudflare Worker** 하나다.

---

## 3. 이관 시 손봐야 할 코드

| 위치 | 내용 | 조치 |
|---|---|---|
| `src/lib/realtime/persist.ts:362-365` | `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` 로 프리뷰 환경/브랜치를 구분 | **Vercel 전용 변수.** 자체 환경변수(`APP_ENV`, `GIT_BRANCH`)로 치환하고 Jenkins 가 주입 |
| `next.config.ts` | `output: 'standalone'` **미설정** | 자체 호스팅 시 추가 권장 — 배포 산출물이 대폭 작아지고 서버에 node_modules 전체를 둘 필요가 없어진다 |
| `package.json` `build` | `prisma migrate deploy && next build` | **빌드에서 분리**. 마이그레이션은 배포 파이프라인의 명시적 단계로 (9장) |
| `ecosystem.config.js` | pm2 설정이 있으나 `cwd` 가 로컬 맥 경로, 앱 이름이 `antigravity` | 서버용으로 재작성 |
| `vercel.json` | `regions: icn1`, `crons: /api/health` | 리전 설정은 폐기. cron 은 서버 cron/Jenkins 로 이전 (8장) |
| `wrangler.toml` `NEXT_APP_URL` | 현재 `https://pharos-weekly-report.vercel.app` | 새 사내 도메인으로 변경 (4장 A안 채택 시) |
| `src/app/api/db-usage/route.ts:46` | `DB_PROVIDER_LABEL` 기본값이 `'Neon 무료'` | 사내 DB 로 바뀌었으니 라벨/용량 한도 갱신 |

---

## 4. 핵심 결정 — 실시간 협업 서버를 어떻게 할 것인가

공동편집이 **Cloudflare Workers + Durable Objects** 위에서 돈다.
Durable Object 는 "문서(룸) 하나당 단일 인스턴스 + 영속 스토리지 + WebSocket Hibernation"을
플랫폼이 보장해 주는 구조라, 일반 Node 서버로 그대로 옮겨지지 않는다.

### A안 — Cloudflare 에 그대로 둔다 (권장)
Next 앱만 사내로 옮기고 Worker 는 유지. `NEXT_APP_URL` 만 새 사내 도메인으로 바꾼다.

- 장점: **실시간 아키텍처를 건드리지 않는다.** 이관 범위가 Next 앱으로 한정돼 위험이 크게 준다
- 단점: 외부(Cloudflare) 의존이 남는다. "완전 사내화" 목표라면 미달
- 부수 효과: `wrangler.toml` 주석에 기록된 기존 장애가 **해소된다**
  > "사내 도메인은 nginx 를 거치며 Vercel 봇 차단(`X-Vercel-Mitigated: challenge`)에 걸린 적이 있고,
  >  Worker 의 fetch 는 자바스크립트 챌린지를 풀 수 없어 그대로 onLoad 실패로 이어진다"

  이관 후에는 nginx 가 자체 Node 앱으로 직접 프록시하므로 Vercel 봇 차단 자체가 사라진다.
  즉 Worker 의 `NEXT_APP_URL` 을 사내 도메인으로 되돌릴 수 있다.

### B안 — 실시간 서버도 사내로 이관
Durable Object 를 대체할 상태 유지 WebSocket 서버를 직접 운영한다.

- 필요 작업: 룸 단위 단일 인스턴스 보장(단일 프로세스 고정 or 룸 샤딩), Yjs 문서 영속화 계층
  재구현, WebSocket Hibernation 대체(유휴 룸 메모리 해제), 재연결·동시성 회귀 테스트 전면 재실행
- 후보: `@hocuspocus/server`(Yjs 전용 Node 서버) 전환 — y-partyserver 를 걷어내고 갈아끼우는 작업
- 난이도: **주간보고 이관 전체보다 이 항목 하나가 더 클 수 있다**

### 권고
**A안으로 진행하고, B안은 별도 과제로 분리**한다.
Next 앱 이관을 먼저 안정화한 뒤 실시간 서버를 논의하는 편이 위험 관리상 유리하다.

---

## 5. 인프라 담당자 요청사항

> 튜토리얼과 달리 **Node 런타임이 상시 구동되는 애플리케이션 서버**가 필요하다.
> 튜토리얼 서버(133.186.240.81)와 같은 VM 에 얹을지, 별도 VM 을 둘지 결정 필요.
> **별도 VM 권장** — 빌드/재시작이 튜토리얼 서빙에 영향을 주지 않게.

### 5-1. 서버 사양·런타임
- [ ] VM 준비 (Ubuntu). Next.js 16 + Prisma 빌드를 감안해 **메모리 2GB 이상 권장**
- [ ] **Node.js 20 LTS 이상** 설치 (Next 16 / React 19 요구. `engines` 미지정이라 명시 필요)
- [ ] 프로세스 관리자 — pm2 또는 systemd (본 계획서는 pm2 기준)
- [ ] 앱 디렉토리 `/var/www/weekly-report/` (releases + current 구조, 튜토리얼과 동일 패턴)
- [ ] 배포 전용 계정 `deploy` + Jenkins 공개키 등록
- [ ] `deploy` 계정에 앱 재시작 권한 (pm2 를 deploy 계정으로 구동하면 sudo 불필요)

### 5-2. nginx (앱 앞단 리버스 프록시)
- [ ] `service-weekly.fingerservice.co.kr` -> `http://127.0.0.1:3000` 프록시
- [ ] **WebSocket 업그레이드 헤더 통과 설정** (A안이라도 브라우저->Cloudflare 직결이라
      필수는 아니지만, B안 대비 및 향후 확장을 위해 미리 넣어둘 것)
      ```
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 3600s;
      ```
- [ ] TLS 인증서 발급 (`service-weekly.fingerservice.co.kr`) — **현재 Vercel 이 발급/갱신 중이라
      사내로 옮기면 새로 발급해야 한다.** Let's Encrypt + certbot 자동갱신
- [ ] gzip 활성화 (Next 가 일부 처리하나 nginx 단에서 한 번 더)

### 5-3. 네트워크
- [ ] 앱 서버 -> **사내 PostgreSQL** 접근 허용 (DB 는 이미 사내 이관 완료)
- [ ] 앱 서버 -> `https://www.googleapis.com` 아웃바운드 허용 (Google Drive 내보내기)
- [ ] **Cloudflare Worker -> 앱 서버 인바운드 허용** (A안 채택 시 필수).
      Worker 가 문서 로드/저장 때 Next 앱 API 를 호출한다. 막히면 **공동편집이 즉시 죽는다**
- [ ] Jenkins -> 앱 서버 SSH(22) 허용

### 5-4. DNS (튜토리얼과 다른 점)
- [ ] `service-weekly.fingerservice.co.kr` 은 현재 **Vercel DNS 직결**(CNAME -> `vercel-dns-017.com`).
      이관 시 **A 레코드를 사내 서버 IP 로 변경해야 한다**
- [ ] TTL 을 미리 낮춰둘 것 (컷오버 전날 300초 등) — 롤백 속도를 좌우한다

---

## 6. 환경변수 이관 (16개)

Vercel -> Jenkins Credentials(또는 서버 `.env`, `chmod 600`)로 옮긴다.
**Vercel 에 저장된 값은 sensitive 라 API 로 다시 읽을 수 없다.** 발급처에서 재확인하거나
재발급해야 하는 항목이 있으니 미리 확인할 것.

| 변수 | 성격 | 이관 메모 |
|---|---|---|
| `DATABASE_URL` | 시크릿 | 사내 DB 접속 문자열. 비밀번호는 URL 인코딩 |
| `SESSION_SECRET` | 시크릿 | **값이 바뀌면 전원 로그아웃**. 기존 값 유지 권장 |
| `REALTIME_TOKEN_SECRET` | 시크릿 | Worker 와 **양쪽이 같아야 한다** |
| `REALTIME_SERVER_SECRET` | 시크릿 | Worker 와 **양쪽이 같아야 한다** (HMAC 서버간 서명) |
| `NEXT_PUBLIC_REALTIME_HOST` | 공개(빌드 시 인라인) | Worker 주소. **빌드 타임에 박히므로 Jenkins 빌드 환경에 반드시 주입** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | 시크릿 | Drive 내보내기용 |
| `GDRIVE_ROOT_FOLDER_ID` | 시크릿 | |
| `CRON_SECRET` | 시크릿 | `/api/health` 인증. 서버 cron 에도 동일 값 필요 |
| `BRIEF_SHARE_KEY` / `BRIEF_COLLAB_FROM` | 시크릿 | |
| `BYPASS_TOKEN` / `BYPASS_USER_ID` | 시크릿 | prod/preview 각각 |
| `DB_PROVIDER_LABEL` / `DB_STORAGE_LIMIT_MB` | 표시용 | 사내 DB 기준으로 갱신 |
| (신규) `APP_ENV` / `GIT_BRANCH` | - | `VERCEL_ENV`/`VERCEL_GIT_COMMIT_REF` 대체 (3장) |

> **보안 지적 1건**: `BYPASS_USER_ID` 가 Vercel 에서 `encrypted`(sensitive 아님)로 설정돼 있다.
> 나머지 15개는 `sensitive` 정상. 전역 규칙상 전부 sensitive 여야 하므로,
> 이관 전에 고치거나 이관 과정에서 정리한다.

> 시크릿을 파일에 넣을 때는 대화/로그에 값이 남지 않도록 **파일 경유 절차**를 따른다
> (GLOBAL.md "보안 시크릿/키 입력" 참조).

---

## 7. Jenkins 파이프라인 설계

튜토리얼(정적 rsync)과 달리 **빌드 -> 마이그레이션 -> 무중단 재시작** 단계가 필요하다.

```
Checkout
  -> Install      (npm ci — package-lock.json 기준. postinstall 이 prisma generate 수행)
  -> Test         (vitest run — 34개 테스트. DB 불필요한 것만. test:db 는 별도 잡 권장)
  -> Build        (next build. NEXT_PUBLIC_* 를 이 단계에 주입해야 번들에 박힌다)
  -> Migrate      (prisma migrate deploy — 9장 전략에 따라 게이트/백업 후)
  -> Deploy       (rsync 산출물 -> releases/<빌드번호>)
  -> Switch       (심볼릭 링크 전환 + pm2 reload)
  -> Smoke test   (/api/health 200, 로그인 페이지 200, 실시간 토큰 발급 API 확인)
  -> Cleanup      (오래된 릴리스 정리)
실패 시 -> 링크 되돌리기 + pm2 reload (단, DB 마이그레이션은 자동 롤백 불가 — 9장)
```

### 무중단 재시작
- `pm2 reload`(cluster 모드)로 순차 교체하면 요청 유실 없이 재시작된다
- **주의 — 확인됨**: Worker 가 Next 앱을 호출하는 `fetch`(`party/index.ts:533`)에
  **재시도·백오프 로직이 없다**(try/catch 로 잡고 끝). 재시작 순간에 호출이 겹치면
  그대로 실패한다. `party/alert.ts` 에 기록된 2026-08-28 장애가 정확히
  "`onLoad` 실패 -> 소켓 1011" 패턴이다.
  -> 대응 두 가지 (둘 다 권장):
     1. **배포는 업무시간 외로** 잡는다
     2. Worker 의 `callNextApp` 에 짧은 재시도(예: 2회, 500ms 백오프)를 추가한다 —
        이관과 별개로 안정성이 오르는 개선이다

### 빌드 산출물 크기 줄이기
`next.config.ts` 에 `output: 'standalone'` 을 추가하면 필요한 node_modules 만 포함된
`.next/standalone` 이 생성돼 배포가 가벼워진다. 단 `outputFileTracingIncludes` 로
Prisma 클라이언트가 포함되도록 이미 설정돼 있으니, standalone 전환 후 **Prisma 엔진이
실제로 포함됐는지 반드시 검증**할 것 (자체호스팅에서 가장 흔한 실패 지점).

---

## 8. Vercel cron 대체

현재 `vercel.json` 이 3일마다 `/api/health` 를 호출한다 (`CRON_SECRET` Bearer 인증, DB `SELECT 1`).

- 원래 목적은 **무료 플랜 DB(Neon) 일시정지 방지**로 보인다(`DB_PROVIDER_LABEL` 기본값이 `'Neon 무료'`).
  DB 를 사내로 옮겼다면 **이 목적은 사라졌을 수 있다** — 폐기 여부 확인 필요
- 헬스체크 자체는 유지 가치가 있다. 대체안:
  - 서버 crontab: `curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/health`
  - 또는 Jenkins 주기 잡 (실패 시 알림까지 붙일 수 있어 더 유용)

---

## 9. DB 마이그레이션 전략 (가장 위험한 부분)

현재 `build` 스크립트에 `prisma migrate deploy` 가 붙어 있다. Jenkins 로 옮길 때 그대로 두면 위험하다.

- **문제 1**: 빌드 실패 시 "스키마만 바뀐 상태"가 남는다
- **문제 2**: **Prisma 는 down 마이그레이션이 없다.** 앱은 심볼릭 링크로 롤백해도
  **스키마는 되돌아가지 않는다.** 구버전 앱 + 신버전 스키마 조합이 되어 장애로 이어질 수 있다
- **문제 3**: 튜토리얼과 달리 "롤백 1초"가 성립하지 않는다

### 권고
1. `build` 에서 `prisma migrate deploy` 를 **분리**하고 파이프라인의 독립 단계로 승격
2. 마이그레이션 단계 **직전에 DB 덤프**(`pg_dump`)를 자동 수행하고 보관
3. 마이그레이션이 있는 배포는 **수동 승인 게이트**를 둔다 (Jenkins `input` 스텝)
4. 스키마 변경은 **하위 호환으로 작성**한다(컬럼 추가는 nullable, 삭제는 2단계 배포).
   그래야 앱만 롤백해도 구버전이 신스키마에서 동작한다
5. 롤백 절차 문서화: 앱 롤백 + (필요 시) DB 덤프 복원 + 그 사이 데이터 처리 방침

---

## 10. 컷오버 절차

튜토리얼과 달리 **DNS 를 바꿔야 하므로** 전환·롤백이 즉시가 아니다.

1. **사전** — DNS TTL 을 300초로 낮춘다 (최소 하루 전)
2. **스테이징 검증** — 임시 도메인(또는 `hosts` 파일)으로 사내 서버의 앱을 먼저 검증
   - 로그인 / 주간보고 작성 / **공동편집 실시간 동기화** / Drive 내보내기 / 취합본 저장
   - **공동편집은 두 브라우저로 반드시 동시 접속 테스트** (Worker <-> 앱 통신 확인)
3. **Worker 설정 변경** — `wrangler.toml` 의 `NEXT_APP_URL` 을 새 사내 도메인으로,
   `npx wrangler deploy`
4. **DNS 전환** — `service-weekly.fingerservice.co.kr` A 레코드를 사내 서버 IP 로
5. **전환 직후 확인** — 응답 헤더에 `server: Vercel` 이 사라지는지, `/api/health` 200
6. **모니터링** — 앱 로그, Cloudflare Worker 로그(`observability` 이미 켜져 있음), DB 커넥션 수
7. **Vercel 프로젝트는 최소 2~4주 유지**

### 롤백
- **DNS 되돌리기** — TTL 만큼(300초) 지연. 즉시가 아님
- Vercel 프로젝트를 남겨두면 앱 자체는 그대로 살아있다
- Worker 의 `NEXT_APP_URL` 도 함께 되돌려야 한다 (`pharos-weekly-report.vercel.app`)
- **DB 마이그레이션을 실행한 뒤라면 앱 롤백만으로 부족하다** — 9장 참조

---

## 11. 위험 요소

| 위험 | 영향 | 완화 |
|---|---|---|
| **DB 마이그레이션 비가역성** | 롤백 불가 상황 | 9장 전략(분리·백업·승인 게이트·하위호환) |
| **Worker <-> 앱 통신 차단** | 공동편집 전면 중단 | 방화벽 인바운드 사전 허용 + 컷오버 전 2인 동시편집 테스트 |
| **배포 중 Worker fetch 실패** | 문서 로드 실패(소켓 1011) | pm2 reload 무중단 + 업무시간 외 배포 |
| **`NEXT_PUBLIC_REALTIME_HOST` 누락** | 빌드에 박히는 값이라 런타임 주입으로 못 고침 | Jenkins **빌드 단계** 환경변수로 주입 |
| **`SESSION_SECRET` 변경** | 전 사용자 로그아웃 | 기존 값 그대로 이관 |
| **TLS 인증서** | Vercel 이 발급하던 것이 사라짐 | certbot 신규 발급 + 자동갱신 확인 |
| **DNS TTL** | 롤백 지연 | 사전에 300초로 인하 |
| **Prisma 엔진 누락** | 런타임에만 터짐(빌드는 성공) | standalone 전환 시 실제 API 호출로 검증 |

---

## 12. 저장소 이관

```bash
git clone --mirror https://github.com/9ja9ja/weeklyReport.git
cd weeklyReport.git
git remote set-url --push origin <사내 GitLab URL>
git push --mirror

cd /Users/jayoung/Work/projects/weekly-report
git remote set-url origin <사내 GitLab URL>
```
- 커밋 99개 / 브랜치 10개 / `.git` 10MB. **LFS 미사용, GitHub Actions 없음**
- GitHub 저장소는 **삭제하지 말고** Archive 처리 (PR 이력 열람용)
- **`.claude/` 가 git 에 추적되고 있다** (`launch.json`, `settings.json`,
  `worktrees/agent-*` 까지 커밋됨 — 확인함). 에이전트 워크트리 사본이 저장소에 들어가 있어
  용량·혼선의 원인이 된다. **이관 전에 `.gitignore` 에 `.claude/worktrees/` 를 추가하고
  `git rm -r --cached` 로 추적 해제**할 것

---

## 13. 미확정 사항 (결정 필요)

1. **실시간 서버: A안(Cloudflare 유지) vs B안(사내 이관)** — 4장. **전체 일정을 좌우**
2. **앱 서버 위치** — 튜토리얼 VM(133.186.240.81) 공용 vs 별도 VM (별도 권장)
3. **`/api/health` cron 유지 여부** — DB 이관으로 원래 목적이 사라졌을 가능성 (8장)
4. **프리뷰 환경 운영 여부** — 현재 Vercel 프리뷰용 env(`DATABASE_URL` preview 등)가 별도로 있다.
   Jenkins 에서 프리뷰를 재현할지, 폐기할지
5. **작업 머신에서 사내 GitLab/Jenkins 접근 가능 여부** (VPN) — 튜토리얼 계획서와 공통

---

## 14. 권장 진행 순서

1. **튜토리얼 먼저 이관** — 위험이 낮아 GitLab/Jenkins/배포 계정 파이프라인을 여기서 검증
2. 그 경험으로 주간보고 파이프라인 구성
3. 주간보고는 **A안(Cloudflare 유지)** 으로 Next 앱만 이관
4. 실시간 서버 사내화(B안)는 별도 과제로 분리
