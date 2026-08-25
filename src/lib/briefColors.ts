/**
 * 요약본에 박혀 들어온 **테마 색**을 가려낸다.
 *
 * 워드·한글·구글독스에서 복사하면 그쪽 편집기의 기본 글자색이 인라인으로 따라온다.
 * 그건 내용이 아니라 **복사한 사람 화면의 설정**이라, 보는 사람의 테마와 반대면 글자가 사라진다.
 * (다크모드에서 복사 → 흰 글씨 → 밝은 화면에서 안 보임. 그 반대도 같다.)
 */

/** 이름으로 쓰인 색 — 워드는 'windowtext'(=본문 기본색)를 자주 내보낸다 */
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  windowtext: [0, 0, 0],
  white: [255, 255, 255],
  window: [255, 255, 255]
};

/** [r,g,b] (0~255). 해석 못 하는 값은 null — 함부로 지우지 않는다 */
export function parseColor(raw: string): [number, number, number] | null {
  const v = raw.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (!rgb) return null;
  const out: [number, number, number] = [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
  return out.every(Number.isFinite) ? out : null;
}

/** 0(검정) ~ 1(흰색) */
export function luminance(raw: string): number | null {
  const c = parseColor(raw);
  return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : null;
}

/** 무채색인가 — 세 채널이 거의 같으면 회색 계열이다 */
function isGrayish(c: [number, number, number]): boolean {
  return Math.max(...c) - Math.min(...c) <= 26;
}

/**
 * 테마 흔적인가 — 지워도 내용이 상하지 않는 색인가.
 *
 * **명도만으로는 못 가른다.** 워드 기본 글자색 `#262626`(명도 0.149)보다
 * 의도해서 고른 짙은 빨강 `#C00000`(0.160)이 오히려 더 밝다. 기준을 낮추면 빨강이 먼저 지워진다.
 * 그래서 **무채색인지**를 먼저 보고, 회색 계열 중 한쪽 테마에서 사라질 만큼
 * 어둡거나 밝은 것만 걷어낸다. 색이 있는 값은 아무리 어두워도 의도한 강조로 본다.
 *
 * 배경색은 다른 잣대를 쓴다. 표 머리의 연회색(rgb(242,242,242), 명도 0.949)이나 파스텔 강조는
 * 회색·고명도라도 **일부러 칠한 것**이라, 사실상 흰색·검정인 경우만 지운다.
 */
export function isThemeArtifactColor(raw: string, isBackground: boolean): boolean {
  const c = parseColor(raw);
  if (!c) return false;
  const l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  if (isBackground) return l > 0.97 || l < 0.04;
  return isGrayish(c) && (l < 0.4 || l > 0.78);
}

/**
 * 화면에서 이 글자색을 무시해야 하는가.
 *
 * 붙여넣기 단계에서 걸러내도 **이미 저장된 문서**에는 그대로 남아 있다. 남이 함께 보는 문서를
 * 자동으로 고쳐 쓰면 되돌리기 어려우므로, 저장된 내용은 두고 **보이는 색만** 테마 기본색으로 바꾼다.
 *
 * 배경이 칠해진 칸과 형광펜 글자는 예외다 — 그 글자색은 배경에 맞춰 고른 것이라,
 * 테마 기본색으로 바꾸면 오히려 그 배경과 겹쳐 안 보이게 된다.
 */
export function shouldIgnoreColor(
  color: string | null | undefined,
  opts: { highlighted?: boolean; onFilledCell?: boolean } = {}
): boolean {
  if (typeof color !== 'string' || !color.trim()) return false;
  if (opts.highlighted || opts.onFilledCell) return false;
  return isThemeArtifactColor(color, false);
}

/**
 * HTML 문자열에서 테마 색 선언만 걷어낸다 (붙여넣기 경로).
 * 빨강·파랑 같은 의도한 색과 정렬·들여쓰기 등 다른 선언은 그대로 둔다.
 */
export function stripThemeColors(html: string): string {
  return html.replace(/\sstyle="([^"]*)"/gi, (whole, styles: string) => {
    const kept = styles
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(decl => {
        const i = decl.indexOf(':');
        if (i < 0) return true;
        const prop = decl.slice(0, i).trim().toLowerCase();
        if (prop !== 'color' && prop !== 'background-color' && prop !== 'background') return true;
        return !isThemeArtifactColor(decl.slice(i + 1), prop !== 'color');
      });
    return kept.length ? ` style="${kept.join('; ')}"` : '';
  });
}

/**
 * HTML 문자열에서 테마 색 + 인라인 font-size 를 모두 걷어낸다.
 *
 * **에디터 콘텐츠 로드 시점**에 쓴다. 기존 저장된 HTML 의 인라인 색상과 font-size 를
 * 제거해 CSS 기본값(12pt, var(--foreground))이 적용되게 한다.
 * 의도적 색(빨강·파랑)과 레이아웃 속성(text-align, width 등)은 보존한다.
 */
export function sanitizeBriefHtml(html: string): string {
  return html.replace(/\sstyle="([^"]*)"/gi, (whole, styles: string) => {
    const kept = styles
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(decl => {
        const i = decl.indexOf(':');
        if (i < 0) return true;
        const prop = decl.slice(0, i).trim().toLowerCase();
        // 인라인 font-size 제거 — CSS 기본 12pt 를 쓰도록
        if (prop === 'font-size') return false;
        // 테마 색 제거
        if (prop === 'color' || prop === 'background-color' || prop === 'background') {
          return !isThemeArtifactColor(decl.slice(i + 1), prop !== 'color');
        }
        return true;
      });
    return kept.length ? ` style="${kept.join('; ')}"` : '';
  });
}
