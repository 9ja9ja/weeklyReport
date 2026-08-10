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
import { Extension, type Extensions, type Editor } from '@tiptap/core';

/**
 * 문단 들여쓰기.
 *
 * 이게 없으면 사람들이 공백이나 붙여넣기의 margin-left 로 들여쓰기를 흉내내는데,
 * 둘 다 HTML 을 다시 파싱하는 순간 사라진다(공백은 HTML 파서가 접고, margin-left 는
 * 스키마에 없는 속성이라 버려진다). 저장·잠금 후 다시 열면 계단 모양이 통째로 풀리는
 * 원인이 이것이다. 들여쓰기를 문단의 정식 속성으로 두면 왕복해도 남는다.
 */
const INDENT_STEP_EM = 1.5;
const MAX_INDENT = 10;
const INDENT_TYPES = ['paragraph', 'heading'];

/** 붙여넣은 HTML 의 margin-left / padding-left / text-indent 를 단계로 환산 */
function readIndentLevel(el: HTMLElement): number {
  const explicit = el.getAttribute('data-indent');
  if (explicit) return clampIndent(parseInt(explicit, 10));

  const style = el.style;
  const raw = style.marginLeft || style.paddingLeft || style.textIndent || '';
  const m = /^(-?[\d.]+)(px|pt|em|rem|cm|mm|in)?$/.exec(raw.trim());
  if (!m) return 0;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;

  // 1단계 = 1.5em ≈ 24px ≈ 18pt. 붙여넣기 값이 제각각이라 단계로 눌러 정규화한다.
  const perStep: Record<string, number> = {
    px: 24, pt: 18, em: INDENT_STEP_EM, rem: INDENT_STEP_EM, cm: 0.63, mm: 6.3, in: 0.25
  };
  const unit = m[2] ?? 'px';
  return clampIndent(Math.round(value / (perStep[unit] ?? 24)));
}

const clampIndent = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_INDENT, n)) : 0);

/** 선택된 문단들의 들여쓰기를 delta 만큼 조정하는 ProseMirror 명령 */
export function changeIndent(delta: number) {
  return ({ state, dispatch }: { state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
    const { selection } = state;
    const tr = state.tr;
    let changed = false;
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (!INDENT_TYPES.includes(node.type.name)) return;
      const cur = clampIndent(Number(node.attrs.indent) || 0);
      const next = clampIndent(cur + delta);
      if (next === cur) return;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      changed = true;
    });
    if (changed && dispatch) dispatch(tr);
    return changed;
  };
}

export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => readIndentLevel(element),
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = clampIndent(Number(attrs.indent) || 0);
              if (n <= 0) return {};
              // data-indent 가 진실원본이다. style 은 눈으로 보이게 하려고 같이 넣는다.
              return { 'data-indent': String(n), style: `margin-left:${n * INDENT_STEP_EM}em` };
            }
          }
        }
      }
    ];
  },

  addKeyboardShortcuts() {
    // 표 안과 목록에서는 Tab 이 이미 칸/단계 이동이다. 그쪽을 가로채면 안 된다.
    const busy = (editor: Editor) =>
      editor.isActive('table') || editor.isActive('listItem') || editor.isActive('taskItem');
    return {
      Tab: ({ editor }) => (busy(editor) ? false : editor.chain().focus().command(changeIndent(1)).run()),
      'Shift-Tab': ({ editor }) => (busy(editor) ? false : editor.chain().focus().command(changeIndent(-1)).run())
    };
  }
});

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
    CustomTableCell,
    Indent
  ];
}

/** Yjs 문서 안에서 본문이 사는 자리 */
export const BRIEF_FRAGMENT = 'default';
/** 제목처럼 본문 밖 값이 사는 자리 */
export const BRIEF_META = 'meta';
export const BRIEF_META_TITLE = 'title';
