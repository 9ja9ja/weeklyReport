/**
 * 요약본(TipTap) 확장 목록 — **서버와 클라이언트가 반드시 같은 것을 써야 한다.**
 *
 * 서버는 Y.XmlFragment 를 HTML 로 되돌릴 때 이 스키마가 필요하다.
 * 목록이 어긋나면 클라이언트에서 멀쩡히 보이던 표·색상이 서버가 만든 HTML 에서 사라진다.
 * 그래서 BriefEditor 안에 두지 않고 여기로 뺐다.
 *
 * 주의: 이 파일은 Next 서버(Node)에서도 import 되므로 브라우저 전용 API 를 쓰면 안 된다.
 */
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import type { Extensions } from '@tiptap/core';

/** 셀 배경색 — 기존 요약본이 쓰던 속성이라 스키마에서 빠지면 색이 날아간다 */
const backgroundColorAttribute = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
    renderHTML: (attrs: Record<string, string | null>) => {
      if (!attrs.backgroundColor) return {};
      return { style: `background-color: ${attrs.backgroundColor}` };
    }
  }
};

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute };
  }
});

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundColorAttribute };
  }
});

/**
 * 문서 구조를 결정하는 확장들.
 *
 * 공동 편집에서는 히스토리를 Yjs 가 관리하므로 StarterKit 의 undoRedo 를 끈다 —
 * 켜두면 로컬 히스토리와 Yjs UndoManager 가 충돌해 남의 변경까지 되돌린다.
 */
export function briefExtensions(opts: { collaborative: boolean } = { collaborative: false }): Extensions {
  return [
    // StarterKit v3 는 underline 을 이미 포함한다. 따로 또 넣으면
    // "Duplicate extension names found: ['underline']" 경고와 함께 스키마가 두 번 등록된다.
    opts.collaborative ? StarterKit.configure({ undoRedo: false }) : StarterKit,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: true }),
    TableRow,
    CustomTableHeader,
    CustomTableCell
  ];
}

/** Yjs 문서 안에서 본문이 사는 자리 */
export const BRIEF_FRAGMENT = 'default';
/** 제목처럼 본문 밖 값이 사는 자리 */
export const BRIEF_META = 'meta';
export const BRIEF_META_TITLE = 'title';
