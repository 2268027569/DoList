/**
 * The rule behind each repeat preset the detail view offers (M02 S6).
 *
 * Breadth first, depth second: the RFC 5545 property list is what the task stores
 * (M02 D2), so a preset is just a rule with a label, and "custom" is the same field
 * with the parser looking at whatever the user typed. Keeping them as data — rather
 * than six branches in the view — is also what lets the view tell "the rule I have
 * is one of these" from "the rule I have is something else", which is what decides
 * whether the custom field is open.
 *
 * Plain data, no `rrule`: this file is imported by the panel, and the parser is
 * main-process only. The panel never asks whether a rule is valid — it sends it and
 * reads back the rejection.
 */

export interface RepeatPreset {
  /** Label key under `detail.repeat.`, and the `data-field` name's suffix. */
  key: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
  rule: string;
}

export const REPEAT_PRESETS: readonly RepeatPreset[] = [
  { key: 'daily', rule: 'FREQ=DAILY' },
  { key: 'weekdays', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { key: 'weekly', rule: 'FREQ=WEEKLY' },
  { key: 'monthly', rule: 'FREQ=MONTHLY' },
  { key: 'yearly', rule: 'FREQ=YEARLY' },
];

/** The preset whose rule is `rule`, or `null` when it is one the user typed. */
export function presetFor(rule: string): RepeatPreset | null {
  return REPEAT_PRESETS.find((preset) => preset.rule === rule) ?? null;
}
