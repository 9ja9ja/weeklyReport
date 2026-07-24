/**
 * 구글 드라이브 내보내기
 *
 * 서비스 계정 대신 OAuth refresh token 을 쓴다 (개인/팀 드라이브 폴더에 바로 쓰기 위함).
 * 필요한 환경변수:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GDRIVE_ROOT_FOLDER_ID   (내보낼 최상위 폴더. 예: 주간보고)
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';

export function isDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GDRIVE_ROOT_FOLDER_ID
  );
}

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`구글 인증 실패: ${data.error_description || data.error || 'unknown'}`);
  }
  return data.access_token as string;
}

/** 이름으로 하위 폴더를 찾고, 없으면 만든다 */
async function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false'
  ].join(' and ');

  const listRes = await fetch(
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listRes.json();
  if (list.files?.length > 0) return list.files[0].id as string;

  const createRes = await fetch(`${DRIVE}/files?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
  });
  const created = await createRes.json();
  if (!created.id) throw new Error(`폴더 생성 실패(${name}): ${JSON.stringify(created.error ?? created)}`);
  return created.id as string;
}

/** 같은 이름 파일이 있으면 휴지통으로 (사본이 계속 쌓이지 않게) */
async function trashExisting(token: string, parentId: string, name: string) {
  const q = [
    `'${parentId}' in parents`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false'
  ].join(' and ');
  const res = await fetch(
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await res.json();
  for (const f of list.files ?? []) {
    await fetch(`${DRIVE}/files/${f.id}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
  }
}

const DOCS = 'https://docs.googleapis.com/v1/documents';

/** 원본 docx 페이지 설정 (A4 가로, 여백 좁게) */
const PAGE = {
  width: 841.9,   // 29.7cm
  height: 595.3,  // 21cm
  marginX: 42.5,
  marginY: 28.35
};

/** 원본 gridCol 비율 — HTML 의 width% 는 세로 기준으로 굳어버려서 API 로 다시 잡는다 */
const COL_RATIO = [870, 1140, 1275, 5880, 5055, 945];

async function docsBatch(token: string, documentId: string, requests: unknown[]) {
  const res = await fetch(`${DOCS}/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  if (!res.ok) throw new Error(await res.text());
}

interface DocTableEl {
  startIndex?: number;
  table?: {
    columns?: number;
    tableRows?: { tableCells?: { content?: DocTableEl[] }[] }[];
  };
}

/**
 * A4 가로로 바꾸고, 모든 표(바깥 보고표 + 셀 안 통계표)의 열 너비를 잡는다.
 * 구글 문서는 HTML 의 폭 지정을 무시하고 표를 최소폭으로 짓눌러버려서,
 * Docs API 로 열 너비를 직접 지정해야 표가 셀을 꽉 채운다.
 */
async function applyOriginalLayout(token: string, documentId: string) {
  try {
    await docsBatch(token, documentId, [
      {
        updateDocumentStyle: {
          documentStyle: {
            pageSize: {
              width: { magnitude: PAGE.width, unit: 'PT' },
              height: { magnitude: PAGE.height, unit: 'PT' }
            },
            marginTop: { magnitude: PAGE.marginY, unit: 'PT' },
            marginBottom: { magnitude: PAGE.marginY, unit: 'PT' },
            marginLeft: { magnitude: PAGE.marginX, unit: 'PT' },
            marginRight: { magnitude: PAGE.marginX, unit: 'PT' }
          },
          fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight'
        }
      }
    ]);

    const usable = PAGE.width - PAGE.marginX * 2;
    const total = COL_RATIO.reduce((a, b) => a + b, 0);
    const reportWidths = COL_RATIO.map(r => (r / total) * usable);
    // 통계표는 금주/차주 셀(3·4열) 안에 들어간다. 둘 중 좁은 차주 폭에서
    // 셀 여백(양쪽 ~6pt)을 뺀 값을 목표로 하면 두 열 모두에서 안 넘치고 꽉 찬다.
    const nestedTarget = Math.max(reportWidths[4] - 12, 120);

    const docRes = await fetch(`${DOCS}/${documentId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const doc = await docRes.json();
    const content: DocTableEl[] = doc.body?.content ?? [];

    const requests: unknown[] = [];

    const setCols = (el: DocTableEl, isReport: boolean) => {
      const t = el.table;
      if (!t || el.startIndex == null) return;
      const nCols = t.columns ?? 0;
      if (nCols === 0) return;

      const widths =
        isReport && nCols === COL_RATIO.length
          ? reportWidths
          : Array.from({ length: nCols }, () => nestedTarget / nCols);

      for (let i = 0; i < nCols; i++) {
        requests.push({
          updateTableColumnProperties: {
            tableStartLocation: { index: el.startIndex },
            columnIndices: [i],
            tableColumnProperties: {
              widthType: 'FIXED_WIDTH',
              width: { magnitude: widths[i], unit: 'PT' }
            },
            fields: 'widthType,width'
          }
        });
      }

      // 셀 안에 든 통계표까지 재귀
      for (const row of t.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          for (const inner of cell.content ?? []) {
            if (inner.table) setCols(inner, false);
          }
        }
      }
    };

    for (const el of content) {
      if (el.table) setCols(el, true);
    }

    if (requests.length > 0) await docsBatch(token, documentId, requests);
  } catch (e) {
    // 레이아웃 보정 실패는 치명적이지 않다 — 내용은 이미 들어가 있다
    console.warn('페이지/열 너비 설정 실패:', e instanceof Error ? e.message : e);
  }
}

/** HTML → 구글 문서 생성 후 원본 레이아웃(A4 가로 + 열 너비) 적용. 문서 id 반환 */
async function createDocFromHtml(
  token: string,
  html: string,
  name: string,
  parents?: string[]
): Promise<string> {
  const boundary = `wr${Math.random().toString(36).slice(2)}`;
  const metadata: Record<string, unknown> = { name, mimeType: DOC_MIME };
  if (parents) metadata.parents = parents;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${html}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  const file = await res.json();
  if (!file.id) throw new Error(`문서 생성 실패: ${JSON.stringify(file.error ?? file)}`);

  await applyOriginalLayout(token, file.id);
  return file.id as string;
}

/**
 * HTML 을 PDF 로 변환한다 (드라이브에 남기지 않음).
 * 구글 문서로 잠깐 만들어 PDF 로 export 한 뒤 그 문서는 휴지통으로 보낸다.
 * → 드라이브 내보내기와 완전히 같은 서식이 나온다.
 */
export async function htmlToPdfViaGoogle(html: string): Promise<Buffer> {
  if (!isDriveConfigured()) throw new Error('구글 환경변수가 설정되지 않았습니다.');
  const token = await getAccessToken();

  const docId = await createDocFromHtml(token, html, `__tmp_pdf_${Date.now()}`);
  try {
    const res = await fetch(`${DRIVE}/files/${docId}/export?mimeType=application/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`PDF export 실패: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    // 임시 문서 정리 (성공/실패 무관)
    await fetch(`${DRIVE}/files/${docId}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    }).catch(() => {});
  }
}

export interface ExportResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  folderPath: string;
}

/**
 * HTML 을 구글 문서로 변환해 <루트>/<YYYY.MM> 아래에 만든다.
 * 폴더 이름은 드라이브에 이미 쌓여 있는 관례(2026.01 … 2026.07)를 따른다.
 * 폴더가 없으면 만들고, 같은 이름 문서가 있으면 옛 것을 휴지통으로 보낸다.
 */
export async function exportHtmlToDrive(opts: {
  html: string;
  fileName: string;
  year: number;
  month: number;
}): Promise<ExportResult> {
  if (!isDriveConfigured()) {
    throw new Error('구글 드라이브 환경변수가 설정되지 않았습니다.');
  }

  const token = await getAccessToken();
  const root = process.env.GDRIVE_ROOT_FOLDER_ID!;

  const monthName = `${opts.year}.${String(opts.month).padStart(2, '0')}`;
  const monthFolder = await ensureFolder(token, root, monthName);

  await trashExisting(token, monthFolder, opts.fileName);

  const fileId = await createDocFromHtml(token, opts.html, opts.fileName, [monthFolder]);

  return {
    fileId,
    fileName: opts.fileName,
    webViewLink: `https://docs.google.com/document/d/${fileId}/edit`,
    folderPath: monthName
  };
}
