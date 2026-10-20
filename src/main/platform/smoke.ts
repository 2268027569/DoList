import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { screen } from 'electron';

import type { Rect } from '@shared/types/app';

/**
 * Marker-input smoke harness (docs/ARCHITECTURE.md §13, first risk row).
 *
 * Enabled only when `YICHEN_SMOKE=1`. The main process publishes the marker
 * rectangle plus every input event the renderers report, so an external script
 * can drive the real OS cursor onto the marker and prove that pointer events
 * reach a transparent, non-focusable window.
 */
export function isSmokeEnabled(): boolean {
  return process.env['YICHEN_SMOKE'] === '1';
}

export function smokeDir(): string {
  return process.env['YICHEN_SMOKE_DIR'] ?? join(tmpdir(), 'yichen-todo-smoke');
}

export function smokeStatusFile(): string {
  return join(smokeDir(), 'status.json');
}

interface SmokeEvent {
  at: number;
  type: string;
  detail?: Record<string, unknown>;
}

const startedAt = Date.now();
const events: SmokeEvent[] = [];
let context: Record<string, unknown> = {};

/** Publishes the environment snapshot the harness needs before it can click. */
export function smokeReady(patch: Record<string, unknown>): void {
  if (!isSmokeEnabled()) return;
  context = { ...context, ...patch };
  flush();
}

/** Records one event coming from a renderer or from the main process itself. */
export function smokeRecord(type: string, detail?: Record<string, unknown>): void {
  if (!isSmokeEnabled()) return;
  events.push(detail === undefined ? { at: Date.now(), type } : { at: Date.now(), type, detail });
  flush();
}

export function smokeMarkerBounds(): Rect | null {
  const bounds = context['markerBounds'];
  return typeof bounds === 'object' && bounds !== null ? (bounds as Rect) : null;
}

/**
 * How far ahead of the wall clock the reminder harness runs (M04).
 *
 * A reminder is armed *before* its deadline, so a run that wanted to watch one arrive
 * would have to sit and wait for it. Moving the scheduler's clock forward instead
 * keeps the arithmetic under test intact — the delay is still `fire_at - now` — while
 * making the moment the run is waiting for already be here. Zero when the harness has
 * not asked for an offset.
 */
export function smokeClockOffsetMs(): number {
  if (!isSmokeEnabled()) return 0;
  const raw = Number(process.env['YICHEN_SMOKE_REMIND_OFFSET_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function flush(): void {
  if (!isSmokeEnabled()) return;
  const payload = {
    startedAt,
    uptimeMs: Date.now() - startedAt,
    ...context,
    displays: screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    })),
    events,
  };
  try {
    mkdirSync(smokeDir(), { recursive: true });
    writeFileSync(smokeStatusFile(), JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // Diagnostics must never break the app.
  }
}
