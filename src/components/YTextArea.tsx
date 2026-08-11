'use client';

/**
 * Y.Text 에 직접 묶이는 자동 확장 textarea.
 *
 * 공동 편집에서 본문을 React state 로 들고 있다가 통째로 되쓰면, 같은 순간 상대가 친 글자가
 * "내가 지운 것"으로 계산돼 사라진다. 그래서 문서의 Y.Text 를 진실원본으로 두고
 * **바뀐 구간만** 반영한다. 한글 조합 중에는 원격 변경을 화면에 얹지 않는다 — 조합이 깨진다.
 */
import { useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useYTextBinding, type DocPeer } from './useSharedDoc';
import PeerField from './PeerField';

interface Props {
  ytext: Y.Text | null;
  origin?: unknown;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  /** 지금 이 칸을 쓰고 있는 다른 사람들 */
  peers?: DocPeer[];
  onFocus?: () => void;
  onBlur?: () => void;
}

const NO_PEERS: DocPeer[] = [];

export default function YTextArea({
  ytext, origin, readOnly, placeholder, className, style, peers = NO_PEERS, onFocus, onBlur
}: Props) {
  const { value, push, compositionProps } = useYTextBinding(ytext, origin);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 내용에 맞춰 높이를 다시 잡는다. 원격 변경으로 줄 수가 바뀌어도 맞아야 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // 이름표를 얹으려면 감싸야 하는데, 감싼 상자가 원래 textarea 자리를 대신해야 한다.
  // flex 값만 상자로 옮기고 나머지 모양은 그대로 둔다.
  const { flex, ...textStyle } = style ?? {};

  return (
    <PeerField peers={peers} style={{ flex, minWidth: 0 }}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        readOnly={readOnly}
        onChange={e => { if (!readOnly) push(e.target.value); }}
        onFocus={onFocus}
        onBlur={onBlur}
        {...compositionProps}
        placeholder={placeholder}
        className={className}
        style={{ ...textStyle, width: '100%' }}
      />
    </PeerField>
  );
}
