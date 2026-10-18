/**
 * Thin wrapper over the smoke channel. Calls are ignored in release builds
 * (the main process only records them when `YICHEN_SMOKE=1`), so call sites do
 * not need to branch on the flag.
 */
export function report(enabled: boolean, type: string, detail?: Record<string, unknown>): void {
  if (!enabled) return;
  void window.api.smoke.report(type, detail);
}
