import type { ReactElement } from 'react';

import type { PanelView } from '@shared/types/app';

/**
 * The sidebar's artwork: one inline SVG per view.
 *
 * Inline and hand-drawn rather than a sprite sheet or an icon font: the project ships
 * no UI component library, and M12 makes self-drawn artwork the rule for anything that
 * has to look the same on both platforms. `currentColor` on a stroke means each icon
 * takes the colour of whatever state its button is in (§7) — there is no second token
 * to keep in step with the first.
 */
export function ViewIcon({ view }: { view: PanelView }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The button carries the accessible name; the drawing beside it is decoration.
      aria-hidden="true"
      focusable="false"
    >
      {ARTWORK[view]}
    </svg>
  );
}

/** Each view's own drawing, grouped here so the sidebar stays about the buttons. */
const ARTWORK: Record<PanelView, ReactElement> = {
  // 收件箱: a tray — where unfiled work lands, which is what the Inbox is.
  inbox: (
    <>
      <path d="M4 13h4l1.6 2.6h4.8L16 13h4" />
      <path d="M4 13 6.2 5h11.6L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    </>
  ),
  // 今天: a calendar page with a dot on it — today's box, marked.
  today: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10.5h17M8 3.5v4M16 3.5v4" />
      <path d="M12 14.5v.01" />
    </>
  ),
  // 明天: the sun coming up over a horizon — the day after this one.
  tomorrow: (
    <>
      <path d="M4 19h16" />
      <path d="M8 19a4 4 0 0 1 8 0" />
      <path d="M12 4.5v3.5M6.4 8.4l2 2M17.6 8.4l-2 2" />
    </>
  ),
  // 即将到期: a clock — the view is about what is coming, not what is here.
  upcoming: (
    <>
      <circle cx="12" cy="12.5" r="7.5" />
      <path d="M12 8.5v4.3l3 1.8" />
    </>
  ),
  // 已完成: the tick the rows themselves are marked with, in a circle.
  completed: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.4 12.6l2.6 2.6 4.6-5.4" />
    </>
  ),
  // 已取消: the same circle, crossed out — the archive of what will not happen.
  cancelled: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
};
