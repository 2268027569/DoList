import type { PanelView } from '@shared/types/app';

/**
 * The panel's views, in the order the sidebar draws them (docs/M03-PLAN.md D2).
 *
 * One table for all three readers — the sidebar (which views exist, and in what
 * order), the header (what the current one is called), the list (what it says when the
 * view is empty). They have to agree: a view the sidebar offers but the header has no
 * name for would be a button opening onto a blank heading.
 *
 * The strings are locale keys rather than sentences, and they carry their namespace:
 * the copy belongs to the locale (§8), and the three readers do not all default to
 * the same namespace.
 */
export interface ViewCopy {
  /** The view's own name, e.g. 收件箱. */
  name: string;
  /** What the list says when this view has nothing in it. */
  empty: string;
}

/**
 * Display order: it reads the way a day does — what is open and undated, now, tomorrow,
 * the week ahead, then the two archives (M03-PLAN D2/D5).
 */
export const VIEW_ORDER: readonly PanelView[] = [
  'inbox',
  'today',
  'tomorrow',
  'upcoming',
  'completed',
  'cancelled',
];

/**
 * Every view's copy keys. A `Record` rather than a list beside the order: a view added
 * to the union cannot compile until it has been given both strings.
 */
export const VIEW_COPY: Record<PanelView, ViewCopy> = {
  inbox: { name: 'tasks:inbox.title', empty: 'tasks:inbox.empty' },
  today: { name: 'tasks:view.today', empty: 'tasks:today.empty' },
  tomorrow: { name: 'tasks:view.tomorrow', empty: 'tasks:tomorrow.empty' },
  upcoming: { name: 'tasks:view.upcoming', empty: 'tasks:upcoming.empty' },
  completed: { name: 'tasks:view.completed', empty: 'tasks:completed.empty' },
  cancelled: { name: 'tasks:view.cancelled', empty: 'tasks:cancelled.empty' },
};
