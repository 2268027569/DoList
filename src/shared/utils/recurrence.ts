/**
 * Repeating tasks (docs/FEATURES.md M02, M02-PLAN §7, decision D2).
 *
 * A thin layer over `rrule` rather than a hand-rolled subset: "custom" means any
 * RRULE the user cares to type, and `BYDAY` / `INTERVAL` / `COUNT` / `UNTIL` /
 * the 31st of a month / February 29th / daylight saving are all places a hand-rolled
 * version quietly gets things wrong.
 *
 * **Main process only.** It lives in `shared/` because that is where the pure,
 * database-free logic is tested — not because the panel should import it: pulling
 * the RRULE parser into the marker or the panel bundle is exactly what this
 * separation avoids. The panel gets the preset list from `repeat-presets.ts`, which
 * is plain data.
 */

import { RRule } from 'rrule';
import type { Options } from 'rrule';

import type { RepeatMode } from '../types/task';
import { withDueTime } from './task-dates';

export interface RepeatContext {
  /** An RRULE property list, e.g. `FREQ=WEEKLY;BYDAY=MO`. */
  rule: string;
  mode: RepeatMode;
  /** The occurrence just completed — the task's own due, which anchors the pattern. */
  due: number;
  /** Whether the due carries a clock time; a date-only one stays at local midnight. */
  dueHasTime: boolean;
  /** The moment it was completed; `after_completion` counts from here. */
  now: number;
}

/**
 * The next occurrence after the one that was just completed, or `null` when the
 * rule produces none (an exhausted `COUNT` / `UNTIL`, or a rule that never matches).
 *
 * The two modes differ in **what anchors the pattern**, which is the whole point of
 * offering both:
 *
 * - `fixed` keeps the anchor on the previous occurrence, so the pattern stays put —
 *   a task repeating every Monday goes on repeating on Mondays however late it is
 *   completed. The bound is the later of the due and now, which is what stops a
 *   late completion from minting a follow-up that is already overdue: the
 *   occurrences missed while it sat there are skipped, not queued up.
 * - `after_completion` re-anchors on the day it was ticked, so the interval is
 *   counted from the completion — "every 3 days" means 3 days from now, and the
 *   weekday is free to drift. The clock time is kept from the task's own due: a
 *   9am task completed at 8pm should be a 9am task again, not an 8pm one.
 */
export function nextOccurrence(context: RepeatContext): number | null {
  const anchor =
    context.mode === 'after_completion' ? sameClockAs(context.due, context.now) : context.due;
  const rule = build(context.rule, anchor);
  if (rule === null) return null;

  const bound = Math.max(context.due, context.now);
  const next = rule.after(new Date(bound), false);
  if (next === null) return null;

  // A date-only task's occurrences stay at local midnight: a floating occurrence
  // can land an hour either side of it across a daylight-saving switch, and the
  // due is meant to be a day, not an instant.
  return context.dueHasTime ? next.getTime() : withDueTime(next.getTime(), false);
}

/**
 * Whether a rule is worth storing. Checked when a rule is written, so a typo comes
 * back as a validation failure instead of a task that silently never repeats.
 *
 * The start is arbitrary: a rule either is or is not one regardless of where it
 * begins.
 */
export function isValidRule(text: string): boolean {
  return build(text, Date.now()) !== null;
}

/**
 * Builds the rule with its start, or `null` when the text is not a usable one.
 *
 * Both halves are guarded: `rrule` tolerates property lists it cannot make sense of
 * (`FREQ=` parses) and objects to them only when the rule is constructed, and a
 * typo'd weekday blows up in the parse. Either way the caller is told "no", rather
 * than the panel catching an exception from a database write.
 *
 * The start has to be in place **before** the rule is built, not patched onto it
 * afterwards: the constructor derives the time of day from the start it is given
 * (`timeset`, `byhour`, `byminute`), so a rule that was built with the default start
 * and had its `dtstart` replaced keeps firing at that default's hour.
 */
function build(text: string, startMs: number): RRule | null {
  // `RRULE:` may or may not be in front — the property list is what `rrule` parses,
  // but users who have copied a rule out of RFC 5545 text will have the prefix with
  // it, and there is no reason to refuse that.
  const rule = text.trim().replace(/^RRULE:/i, '').trim();
  // `FREQ` is the one property RFC 5545 requires, and `rrule` does not insist on
  // it: `COUNT=5` on its own parses, and quietly becomes a yearly rule.
  if (!/FREQ=/i.test(rule)) return null;
  try {
    const options: Partial<Options> = RRule.parseString(rule);
    options.dtstart = new Date(startMs);
    return new RRule(options);
  } catch {
    return null;
  }
}

/** The clock time of `template` on the local date of `day`. */
function sameClockAs(template: number, day: number): number {
  const time = new Date(template);
  const date = new Date(day);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    time.getHours(),
    time.getMinutes(),
  ).getTime();
}
