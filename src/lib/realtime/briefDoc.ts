/**
 * 요약본 Y.Doc ↔ HTML 변환.
 *
 * 주간보고(materialize.ts)와 같은 원칙이다 — **변환은 Next 서버에서만** 한다.
 * Worker 가 계산해 보낸 HTML 을 믿으면 룸이 오염됐을 때 그대로 DB 에 실린다.
 * Worker 는 ydoc 바이트만 보낸다.
 */
import * as Y from 'yjs';
import { generateHTML, generateJSON } from '@tiptap/html';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { getSchema } from '@tiptap/core';
import { briefExtensions, BRIEF_FRAGMENT, BRIEF_META, BRIEF_META_TITLE } from './briefSchema';

const extensions = briefExtensions({ collaborative: true });

/**
 * ProseMirror 스키마.
 *
 * 반드시 정적 import 로 가져와야 한다. require() 로 부르면 @tiptap/core 가 CJS 로 해석돼
 * prosemirror-model 이 CJS/ESM 두 진입점으로 각각 로드되고, 클래스 동일성이 깨져
 * "multiple versions of prosemirror-model were loaded" 로 변환이 실패한다.
 */
const schema = getSchema(extensions);

/** Y.Doc → 본문 HTML */
export function briefToHtml(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(BRIEF_FRAGMENT);
  // 빈 문서를 굳이 <p></p> 로 만들지 않는다 — 기존 Brief.content 도 빈 문자열을 쓴다
  if (fragment.length === 0) return '';
  const json = yXmlFragmentToProsemirrorJSON(fragment);
  return generateHTML(json, extensions);
}

/** Y.Doc → 제목 */
export function briefTitle(doc: Y.Doc): string {
  const t = doc.getMap(BRIEF_META).get(BRIEF_META_TITLE);
  if (t instanceof Y.Text) return t.toString();
  return typeof t === 'string' ? t : '';
}

/**
 * HTML → 새 Y.Doc (시드 전용).
 *
 * 이 함수로 만든 문서를 두 번 만들어 병합하면 안 된다 — 다른 clientID 로 생성된
 * 두 문서는 내용이 같아도 중복·소실을 만든다. seedId 가 그 방어선이다.
 */
export function buildBriefDoc(html: string, title: string, seedId: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap(BRIEF_META);
    meta.set('seedId', seedId);
    const t = new Y.Text();
    if (title) t.insert(0, title);
    meta.set(BRIEF_META_TITLE, t);

    if (html && html.trim()) {
      const json = generateJSON(html, extensions);
      prosemirrorJSONToYXmlFragment(schema, json, doc.getXmlFragment(BRIEF_FRAGMENT));
    }
  });
  return doc;
}

export function briefSeedId(doc: Y.Doc): string {
  const v = doc.getMap(BRIEF_META).get('seedId');
  return typeof v === 'string' ? v : '';
}
