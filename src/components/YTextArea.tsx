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
import { useYTextBinding } from './useSharedDoc';

interface Props {
  ytext: Y.Text | null;
  origin?: unknown;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function YTextArea({ ytext, origin, readOnly, placeholder, className, style }: Props) {
  const { value, push, compositionProps } = useYTextBinding(ytext, origin);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 내용에 맞춰 높이를 다시 잡는다. 원격 변경으로 줄 수가 바뀌어도 맞아야 한다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={readOnly}
      onChange={e => { if (!readOnly) push(e.target.value); }}
      {...compositionProps}
      placeholder={placeholder}
      className={className}
      style={style}
    />
  );
}
