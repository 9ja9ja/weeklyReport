'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension, type Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type * as Y from 'yjs';
import { briefExtensions, BRIEF_FRAGMENT } from '@/lib/realtime/briefSchema';

interface Props {
  content: string;
  onChange: (html: string) => void;
  editable: boolean;
  /**
   * 실시간 공동 편집용 Y.Doc. 주면 본문의 진실원본이 이 문서가 되고,
   * `content` prop 은 무시된다 (둘 다 반영하면 서로 덮어쓴다).
   */
  ydoc?: Y.Doc | null;
  /** awareness 를 가진 provider — 원격 커서 표시용 */
  provider?: { awareness: unknown } | null;
  /**
   * 원격 커서에 붙일 내 정보.
   *
   * CollaborationCaret 은 초기화 때 awareness 의 `user` 필드를 **이 값으로 통째로 덮어쓴다**.
   * uid 를 빼먹으면 접속자 목록이 자기 자신까지 전부 걸러져 영원히 비어 보인다.
   */
  user?: { uid: number; name: string; color: string } | null;
  /** 전주차 복사처럼 바깥에서 편집기를 조작해야 할 때 쓴다 */
  onReady?: (editor: Editor | null) => void;
}

function cleanWordHtml(html: string): string {
  let h = html;
  h = h.replace(/<!\[if[^>]*>[\s\S]*?<!\[endif\]>/gi, '');
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  h = h.replace(/<o:p[\s\S]*?<\/o:p>/gi, '');
  h = h.replace(/<xml[\s\S]*?<\/xml>/gi, '');
  h = h.replace(/<style[\s\S]*?<\/style>/gi, '');
  h = h.replace(/<meta[^>]*>/gi, '');
  h = h.replace(/<link[^>]*>/gi, '');
  h = h.replace(/\bclass="[^"]*"/gi, '');
  h = h.replace(/\blang="[^"]*"/gi, '');
  h = h.replace(/\bvalign="([^"]*)"/gi, 'style="vertical-align:$1"');

  h = h.replace(/\bstyle="([^"]*)"/gi, (_, styles: string) => {
    const keep: string[] = [];
    const pairs = styles.split(';').map((s: string) => s.trim()).filter(Boolean);
    for (const p of pairs) {
      const [prop] = p.split(':').map((s: string) => s.trim());
      if (!prop) continue;
      if (prop.startsWith('mso-')) continue;
      if (['font-family', 'font-size', 'line-height', 'margin', 'margin-top', 'margin-bottom',
           'margin-left', 'margin-right', 'padding', 'text-indent'].includes(prop)) continue;
      keep.push(p);
    }
    return keep.length ? `style="${keep.join('; ')}"` : '';
  });

  h = h.replace(/<span\s*>([\s\S]*?)<\/span>/gi, '$1');
  h = h.replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1');
  h = h.replace(/<div([^>]*)>/gi, '<p$1>');
  h = h.replace(/<\/div>/gi, '</p>');
  h = h.replace(/\bwidth="(\d+)"/gi, 'style="width:$1px"');
  h = h.replace(/\bheight="(\d+)"/gi, '');

  h = h.replace(/<p[^>]*>\s*(&nbsp;| )?\s*<\/p>/gi, '');
  h = h.replace(/(\s*\n\s*)+/g, '\n');

  return h.trim();
}

const WordPaste = Extension.create({
  name: 'wordPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wordPaste'),
        props: {
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;
            const html = clipboardData.getData('text/html');
            if (!html) return false;
            const isWord = /xmlns:w=|xmlns:o=|mso-|class="Mso/i.test(html);
            if (!isWord) return false;

            event.preventDefault();
            const cleaned = cleanWordHtml(html);
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<body>${cleaned}</body>`, 'text/html');
            const fragment = doc.body.innerHTML;

            (this as unknown as { editor: { commands: { insertContent: (c: string) => void } } }).editor.commands.insertContent(fragment);
            return true;
          },
        },
      }),
    ];
  },
});

export default function BriefEditor({ content, onChange, editable, ydoc, provider, user, onReady }: Props) {
  const collaborative = !!ydoc;

  const editor = useEditor({
    // 서버(HTML 변환)와 같은 확장 목록을 쓴다. 어긋나면 서버가 만든 HTML 에서
    // 표·색상이 조용히 사라진다.
    extensions: [
      ...briefExtensions({ collaborative }),
      WordPaste,
      ...(ydoc ? [Collaboration.configure({ document: ydoc, field: BRIEF_FRAGMENT })] : []),
      ...(ydoc && provider && user
        ? [CollaborationCaret.configure({ provider, user })]
        : []),
    ],
    // 공동 편집일 때 초기 content 를 주면 Yjs 문서와 합쳐져 내용이 두 벌이 된다
    content: collaborative ? undefined : content,
    editable,
    immediatelyRender: false,
    // 공동 편집일 때는 본문의 진실원본이 Y.Doc 이라 HTML 이 필요 없다.
    // 그런데도 매 변경마다 getHTML() 을 돌리면 원격 타이핑 한 글자마다 표까지 통째로 직렬화된다.
    onUpdate: collaborative ? undefined : ({ editor: e }) => onChange(e.getHTML()),
  }, [collaborative, ydoc, provider, user]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onReady?.(editor ?? null);
  }, [editor, onReady]);

  const setContent = useCallback((html: string) => {
    if (!editor || collaborative) return;
    const cur = editor.getHTML();
    if (cur !== html) editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, collaborative]);

  useEffect(() => { setContent(content); }, [content, setContent]);

  if (!editor) return null;

  return (
    <div className="brief-editor-wrap">
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="brief-editor-content" />
    </div>
  );
}

const I = {
  bold: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>,
  italic: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>,
  underline: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>,
  strike: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4H9a3 3 0 0 0 0 6h6"/><path d="M8 20h7a3 3 0 0 0 0-6H4"/><line x1="4" y1="12" x2="20" y2="12"/></svg>,
  ul: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>,
  ol: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="5" y="8" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">1</text><text x="5" y="14" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">2</text><text x="5" y="20" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">3</text></svg>,
  alignLeft: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>,
  alignCenter: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
  alignRight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>,
  table: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>,
  addCol: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="12" height="18" rx="1.5"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="15" x2="15" y2="15"/><line x1="20" y1="9" x2="20" y2="15"/><line x1="17" y1="12" x2="23" y2="12"/></svg>,
  delCol: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="12" height="18" rx="1.5"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="15" y2="9"/><line x1="3" y1="15" x2="15" y2="15"/><line x1="17.5" y1="10" x2="22.5" y2="14" stroke="#ef4444"/><line x1="22.5" y1="10" x2="17.5" y2="14" stroke="#ef4444"/></svg>,
  addRow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="12" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="15"/><line x1="15" y1="3" x2="15" y2="15"/><line x1="12" y1="17" x2="12" y2="23"/><line x1="9" y1="20" x2="15" y2="20"/></svg>,
  delRow: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="12" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="15"/><line x1="15" y1="3" x2="15" y2="15"/><line x1="9" y1="18.5" x2="15" y2="22.5" stroke="#ef4444"/><line x1="15" y1="18.5" x2="9" y2="22.5" stroke="#ef4444"/></svg>,
  merge: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="12"/><path d="M8 17l4-3 4 3" strokeWidth="2"/></svg>,
  split: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>,
  delTable: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" opacity="0.4"/><line x1="3" y1="9" x2="21" y2="9" opacity="0.4"/><line x1="3" y1="15" x2="21" y2="15" opacity="0.4"/><line x1="9" y1="3" x2="9" y2="21" opacity="0.4"/><line x1="5" y1="5" x2="19" y2="19" stroke="#ef4444" strokeWidth="2.5"/><line x1="19" y1="5" x2="5" y2="19" stroke="#ef4444" strokeWidth="2.5"/></svg>,
  cellFill: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="4" y="4" width="7" height="7" fill="currentColor" opacity="0.3" stroke="none"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/></svg>,
  undo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  redo: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>,
  clear: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>,
  fontColor: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 19h14"/><path d="M7 16L12 4l5 12"/><path d="M8.5 13h7"/></svg>,
  highlight: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  chevron: <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 3l3 3 3-3z"/></svg>,
};

const CELL_COLORS = [
  null,
  '#f3f4f6', '#e5e7eb', '#d1d5db',
  '#dbeafe', '#bfdbfe', '#93c5fd',
  '#dcfce7', '#bbf7d0', '#86efac',
  '#fef9c3', '#fef08a', '#fde047',
  '#fee2e2', '#fecaca', '#fca5a5',
  '#f3e8ff', '#e9d5ff', '#d8b4fe',
  '#ffedd5', '#fed7aa', '#fdba74',
];

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showCellColor, setShowCellColor] = useState(false);
  const tableMenuRef = useRef<HTMLDivElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const cellColorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tableMenuRef.current && !tableMenuRef.current.contains(e.target as Node)) setShowTableMenu(false);
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) setShowStyleMenu(false);
      if (cellColorRef.current && !cellColorRef.current.contains(e.target as Node)) setShowCellColor(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!editor) return null;

  const btn = (icon: React.ReactNode, tooltip: string, action: () => void, isActive?: boolean) => (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); action(); }}
      className={`tb-btn${isActive ? ' active' : ''}`}
      title={tooltip}
    >
      {icon}
    </button>
  );

  const currentStyle = editor.isActive('heading', { level: 1 }) ? '제목 1'
    : editor.isActive('heading', { level: 2 }) ? '제목 2'
    : editor.isActive('heading', { level: 3 }) ? '제목 3'
    : '본문';

  return (
    <div className="brief-toolbar">
      <div className="tb-group" ref={styleMenuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); setShowStyleMenu(!showStyleMenu); }}
          className={`tb-btn tb-btn-dropdown tb-style-btn${showStyleMenu ? ' active' : ''}`}
          title="텍스트 스타일"
        >
          <span>{currentStyle}</span>
          {I.chevron}
        </button>
        {showStyleMenu && (
          <div className="tb-dropdown tb-style-dropdown">
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().setParagraph().run(); setShowStyleMenu(false); }}>
              <span style={{ fontSize: '13px' }}>본문</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 1 }).run(); setShowStyleMenu(false); }}>
              <span style={{ fontSize: '18px', fontWeight: 800 }}>제목 1</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); setShowStyleMenu(false); }}>
              <span style={{ fontSize: '15px', fontWeight: 700 }}>제목 2</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); setShowStyleMenu(false); }}>
              <span style={{ fontSize: '13px', fontWeight: 700 }}>제목 3</span>
            </button>
          </div>
        )}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(I.bold, '굵게 (Ctrl+B)', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
        {btn(I.italic, '기울임 (Ctrl+I)', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
        {btn(I.underline, '밑줄 (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
        {btn(I.strike, '취소선', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(I.ul, '글머리 기호', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
        {btn(I.ol, '번호 매기기', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(I.alignLeft, '왼쪽 맞춤', () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }))}
        {btn(I.alignCenter, '가운데 맞춤', () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }))}
        {btn(I.alignRight, '오른쪽 맞춤', () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }))}
      </div>
      <div className="tb-sep" />
      <div className="tb-group" ref={tableMenuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); setShowTableMenu(!showTableMenu); }}
          className={`tb-btn tb-btn-dropdown${showTableMenu ? ' active' : ''}`}
          title="표"
        >
          {I.table}
          {I.chevron}
        </button>
        {showTableMenu && (
          <div className="tb-dropdown">
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().insertTable({ rows: 3, cols: 4, withHeaderRow: true }).run(); setShowTableMenu(false); }}>
              {I.table}<span>표 삽입</span>
            </button>
            <div className="tb-dropdown-sep" />
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}>
              {I.addCol}<span>열 추가</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}>
              {I.delCol}<span>열 삭제</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}>
              {I.addRow}<span>행 추가</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}>
              {I.delRow}<span>행 삭제</span>
            </button>
            <div className="tb-dropdown-sep" />
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().mergeCells().run(); }}>
              {I.merge}<span>셀 병합</span>
            </button>
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().splitCell().run(); }}>
              {I.split}<span>셀 분할</span>
            </button>
            <div className="tb-dropdown-sep" />
            <button onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}>
              {I.delTable}<span>표 삭제</span>
            </button>
          </div>
        )}
      </div>
      <div className="tb-group" ref={cellColorRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); setShowCellColor(!showCellColor); }}
          className={`tb-btn tb-btn-dropdown${showCellColor ? ' active' : ''}`}
          title="셀 배경색"
        >
          {I.cellFill}
          {I.chevron}
        </button>
        {showCellColor && (
          <div className="tb-dropdown tb-color-palette">
            <div className="tb-palette-label">셀 배경색</div>
            <div className="tb-palette-grid">
              {CELL_COLORS.map((c, i) => (
                <button
                  key={i}
                  className={`tb-palette-swatch${c === null ? ' tb-swatch-none' : ''}`}
                  style={c ? { background: c } : undefined}
                  title={c === null ? '없음' : c}
                  onMouseDown={e => {
                    e.preventDefault();
                    editor.chain().focus().setCellAttribute('backgroundColor', c).run();
                    setShowCellColor(false);
                  }}
                >
                  {c === null && <svg width="12" height="12" viewBox="0 0 12 12" stroke="#999" strokeWidth="1.5"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <label className="tb-color-wrap" title="글자 색">
          {I.fontColor}
          <span className="tb-color-bar" />
          <input type="color" onChange={e => editor.chain().focus().setColor(e.target.value).run()} className="tb-color-input" />
        </label>
        <label className="tb-color-wrap tb-highlight-wrap" title="배경 색 (형광펜)">
          {I.highlight}
          <span className="tb-color-bar" style={{ background: '#fef08a' }} />
          <input type="color" defaultValue="#fef08a" onChange={e => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} className="tb-color-input" />
        </label>
        {btn(I.clear, '서식 지우기', () => editor.chain().focus().unsetAllMarks().clearNodes().run())}
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        {btn(I.undo, '실행 취소 (Ctrl+Z)', () => editor.chain().focus().undo().run())}
        {btn(I.redo, '다시 실행 (Ctrl+Y)', () => editor.chain().focus().redo().run())}
      </div>
    </div>
  );
}
