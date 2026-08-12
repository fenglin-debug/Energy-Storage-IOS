/**
 * Material-style inline SVG icons (Android 0.2.0 look): filled, currentColor.
 */
import type { SVGProps } from 'react';

interface IconProps {
  size?: number;
  filled?: boolean;
}

function base(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': true,
  };
}

/** Material "list" — 词汇 tab */
export function IconVocabulary({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
    </svg>
  );
}

/** Material "play_arrow" — 情景 tab */
export function IconScenario({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Material "star" — 文章 tab */
export function IconArticle({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

/** Material "settings" — 齿轮 */
export function IconSettings({ size = 22 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

/** Material "star" (outline when not filled) — 收藏 */
export function IconStar({ size = 20, filled = false }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Material "play_arrow" — 播放按钮 */
export function IconPlay({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
