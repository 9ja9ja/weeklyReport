# 요약본 첨부파일·보고메일 — 사내 서버 설정

요약본의 팀별 첨부파일과 "보고메일 보내기"가 사내 서버에서 동작하려면 아래가 필요하다.

## 1. 환경변수 (서버 `.env` 또는 Jenkins 주입)

| 변수 | 값 | 비고 |
|---|---|---|
| `ATTACHMENT_DIR` | 예) `/data/weekly-report/attachments` | **앱 폴더 밖** 절대 경로. 운영에서 없으면 업로드가 503 으로 막힌다 |
| `SMTP_HOST` | 메일 서버 주소 | 없으면 실제 발송 없이 이력만 남는다(테스트 모드) |
| `SMTP_PORT` | 587 (SSL 이면 465) | |
| `SMTP_SECURE` | 465 포트면 `true` | |
| `SMTP_USER`, `SMTP_PASS` | 계정 | 비밀번호는 서버 `.env`(`chmod 600`)나 Jenkins Credentials 에만 둔다 |
| `MAIL_FROM` | 기본 `Finger <no-reply@finger.co.kr>` | SMTP 서버가 이 주소로 보내는 것을 허용해야 한다 |
| `NEXT_APP_URL` | `https://service-weekly.fingerservice.co.kr` | 메일 속 "요약본 전체 보기" 링크 |

## 2. 저장 폴더

```
sudo mkdir -p /data/weekly-report/attachments
sudo chown <앱 실행 계정> /data/weekly-report/attachments
sudo chmod 700 /data/weekly-report/attachments
```
- 배포가 새 폴더로 갈아끼우는 방식(심볼릭 링크 전환)이어도 앱 폴더 밖이라 파일이 유지된다.
- 이 폴더를 **백업 대상에 포함**한다. DB 에는 파일명·크기만 있고 본문은 이 폴더에만 있다.
- 여러 대로 늘리면 같은 폴더를 공유(NAS 마운트 등)해야 한다. `ATTACHMENT_DIR` 만 마운트 경로로 바꾸면 된다.

## 3. nginx 업로드 한도

nginx 기본 한도(1MB)면 첨부 업로드가 413 으로 실패한다. 파일은 개당 10MB 까지 받으므로 여유를 둔다.

```
location /api/briefs/attachments {
    client_max_body_size 20m;
    proxy_pass http://<앱>;
}
```
(전체 `server` 블록에 두어도 된다.)

## 4. 마이그레이션

이 기능은 신규 테이블(`BriefTeamCheck`, `BriefAttachment`, `BriefMailRecipient`, `BriefMailLog`)과
`Team.briefExcluded` 컬럼을 추가한다 — `prisma/migrations/20261017000000_add_brief_team_check`.
- 하위 호환(컬럼 추가·테이블 추가뿐)이라 롤백해도 기존 화면은 영향이 없다.
- `Team.briefExcluded` 는 마이그레이션이 `PMO`, `땡겨요`, `비즈니스플랫폼본부`에 켠다. 팀 이름이 다르면 적용되지 않으니 배포 후 확인한다.
- 수신자 초기값은 한 번만 실행: `node prisma/seed_brief_mail_recipients.mjs`
  (이미 있는 이메일은 건드리지 않아 여러 번 실행해도 안전하다).

## 5. 배포 후 확인 순서

1. `npm run mail:test -- --verify-only` — SMTP 접속·인증
2. `npm run mail:test -- 내주소@finger.co.kr` — 시험 메일 수신 확인(발신자 표시 `Finger`)
3. 요약본에서 자기 팀 줄을 펼쳐 파일 업로드 → 다운로드 → 삭제
4. 요약본을 잠근 뒤 "보고메일 보내기" → **받는 사람을 본인 한 명으로 바꿔서** 발송 → 첨부 포함 확인
   (수신자 목록은 발송 시 저장되므로, 확인 후 원래 수신자로 되돌려 저장한다)
5. 이상 없으면 실제 수신자로 발송

> 첫 실발송 때 수신자를 본인으로 바꿔 둔 목록이 그대로 저장된다.
> 본 발송 전에 반드시 원래 임원·팀장 목록으로 복원할 것.
