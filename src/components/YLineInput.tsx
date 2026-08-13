'use client';

/**
 * Y.Text 에 직접 묶이는 한 줄 입력칸 (표 제목처럼 짧은 칸).
 *
 * 공동 편집에서 값을 통째로 되쓰면(delete 전체 → insert 전체) 같은 순간 상대가 친 글자까지
 * 지워져 한쪽 제목이 통째로 사라지거나 두 제목이 이어붙는다. 소분류·불릿과 같은 이유로
 * **바뀐 구간만** 반영한다. 한글 조합 중에는 원격 변경을 화면에 얹지 않는다.
 *
 * YTextArea 의 한 줄 판이다 — 그쪽은 높이 자동 조절이 필요해 textarea 를 쓴다.
 */
import { useYTextBinding } from './useSharedDoc';
import type * as Y from 'yjs';

interface Props {
  ytext: Y.Text | null;
  origin?: unknown;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onFocus?: () => void;
  onBlur?: () => void;
}

export default function YLineInput({
  ytext, origin, readOnly, placeholder, className, style, onFocus, onBlur
}: Props) {
  const { value, push, compositionProps, endComposing } = useYTextBinding(ytext, origin);

  return (
    <input
      value={value}
      readOnly={readOnly}
      onChange={e => { if (!readOnly) push(e.target.value); }}
      onFocus={onFocus}
      // 조합 중에 칸을 떠나도 플래그가 굳지 않게 여기서도 풀어 준다
      onBlur={() => { endComposing(); onBlur?.(); }}
      {...compositionProps}
      placeholder={placeholder}
      className={className}
      style={style}
    />
  );
}
