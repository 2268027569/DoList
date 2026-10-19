/**
 * Subtask summaries (docs/FEATURES.md M02: "一层子任务 + 完成进度汇总").
 *
 * A parent's row shows how far along its subtasks are, and the tally has to mean
 * the same thing in the list, in the detail and in the harness's own report — so it
 * is computed once, from the counts the repository read, rather than being counted
 * again wherever it is drawn.
 */

import type { SubtaskCounts } from '../types/task';

/**
 * The `2/3` a parent row shows, or `null` when there is nothing to summarise.
 *
 * Cancelled subtasks are left out by the query, so a parent whose work was dropped
 * reads as done rather than as forever incomplete.
 */
export function progressText(counts: SubtaskCounts): string | null {
  return counts.total === 0 ? null : `${counts.done}/${counts.total}`;
}

/**
 * Whether every subtask is done. A parent with no subtasks is **not** complete: a
 * `0/0` badge that turned green would claim progress that does not exist.
 */
export function allSubtasksDone(counts: SubtaskCounts): boolean {
  return counts.total > 0 && counts.done === counts.total;
}
