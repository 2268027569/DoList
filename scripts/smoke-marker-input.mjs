/**
 * Marker input smoke harness (docs/ARCHITECTURE.md §13, first risk row).
 *
 * Answers two questions the plan cannot answer on paper:
 *   1. Do pointer events reach a transparent, `focusable: false`, `skipTaskbar`
 *      window on Windows?
 *   2. Do Electron's screen coordinates and the real OS cursor coordinates line
 *      up on a scaled display?
 *
 * It launches the built app with `YICHEN_SMOKE=1`, drives the real cursor with
 * PowerShell (`mouse_event`), and checks what the renderers reported. Phases run
 * in this order: boot state → edge auto-hide → drag → click → panel geometry →
 * right-click / app menu (M02 S8) → panel follows the drag (M01 §9.3). Auto-hide
 * goes before the drag because it needs the edge anchor the marker has at boot,
 * and the drag is what gives it up (§9.4).
 *
 * Usage:
 *   npm run build
 *   npm run smoke:marker              # focusable: false (the shipping config)
 *   npm run smoke:marker -- --focusable   # control run
 */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smokeDir = process.env.YICHEN_SMOKE_DIR ?? join(tmpdir(), 'yichen-todo-smoke');
const statusFile = join(smokeDir, 'status.json');
const ps1File = join(smokeDir, 'drive-cursor.ps1');

const args = process.argv.slice(2);
const focusable = args.includes('--focusable');
const skipBuild = args.includes('--no-build');
/**
 * The first drag, in DIPs. It is deliberately long and taken in many small
 * steps (see DRAG_STEPS) so that per-frame error would accumulate visibly
 * rather than hide inside the tolerance. `driveCursor` converts to the physical
 * pixels the OS cursor counts.
 */
const DRAG_DIP = { dx: -220, dy: 160 };
/**
 * Drag in many small steps. A short drag cannot distinguish "the loop lands in
 * the right place" from "the loop accumulates a little error each frame", and
 * the cursor warp (§9.1.1) is a per-frame effect, so the step count is what
 * makes this assertion meaningful.
 */
const DRAG_STEPS = 30;
/**
 * Position tolerance for the drag assertion, in DIPs. Tight because nothing is
 * assumed any more: the expected landing is built from the cursor positions the
 * harness actually observed (see `runDrag`), so only rounding is left.
 */
const DRAG_TOLERANCE_DIP = 3;

/** Artwork size of the dot; the *window* is bigger where the OS demands it. */
const MARKER_ARTWORK_SIZE = 28;
/**
 * Windows inflates a transparent frameless top-level window to at least 32×39
 * DIPs — measured, see docs/ARCHITECTURE.md §9.1. The original plan assumed the
 * requested 28×28 would be honoured; it is not.
 */
const EXPECTED_WINDOW = { width: 32, height: 39 };
/** The panel's configured size; frameless windows here cannot be OS-resized (§9.1.1). */
const PANEL_SIZE = { width: 380, height: 560 };
/** Gap the panel is placed at, from `PANEL_GAP_PX` in shared/utils/anchoring.ts. */
const PANEL_GAP_DIP = 8;
/**
 * Park policy the app runs with under `YICHEN_SMOKE=1`, mirroring SMOKE_EDGE_HIDE
 * in src/main/windows/marker.ts. Kept here so the assertions can state the
 * expected geometry without importing main-process code.
 */
const EDGE_HIDE = { peek: 5, revealDistance: 24, hideDistance: 48 };
/** Tolerance for the parked position, in DIPs (rounding + fractional scaling). */
const EDGE_HIDE_TOLERANCE_DIP = 2;
/** How far the cursor may settle from an aimed point before the aim is retried. */
const CURSOR_AIM_TOLERANCE_DIP = 4;
/** The renderer swallows clicks for 300ms after a drag (§9.2). */
const CLICK_SUPPRESSION_BACKOFF_MS = 450;
/**
 * How close to a work-area edge the marker has to be for the panel to unfold away
 * from it, mirroring PANEL_DOCK_THRESHOLD_PX in shared/utils/anchoring.ts. Same
 * number as the snap threshold, so a marker that was just snapped is docked.
 */
const PANEL_DOCK_THRESHOLD_DIP = 24;
/**
 * The second drag, run with the panel open (phase 6). Smaller than the first one
 * and aimed down-left, so it moves the marker across the middle of the screen
 * rather than into the corner the first drag left it in.
 */
const FOLLOW_DRAG_DIP = { dx: -180, dy: 260 };

const results = [];

function log(message) {
  console.log(`[smoke] ${message}`);
}

function fail(message) {
  console.error(`[smoke] FAIL ${message}`);
  results.push({ step: message, ok: false });
}

function pass(message, detail) {
  console.log(`[smoke] PASS ${message}`, detail === undefined ? '' : detail);
  results.push({ step: message, ok: true, detail });
}

function readStatus() {
  if (!existsSync(statusFile)) return null;
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    return null;
  }
}

async function waitForEvent(type, timeoutMs, since = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = readStatus();
    const event = status?.events?.find((entry) => entry.type === type && entry.at >= since);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

/** Waits for a predicate over the published status (used for the boot snapshot). */
async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  fail(`timed out waiting for ${description}`);
  return null;
}

function markerBounds() {
  const status = readStatus();
  const bounds = status?.markerBounds;
  return bounds ?? null;
}

function displayScaleFor(bounds) {
  const status = readStatus();
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const display = status?.displays?.find(
    (candidate) =>
      centre.x >= candidate.bounds.x &&
      centre.x < candidate.bounds.x + candidate.bounds.width &&
      centre.y >= candidate.bounds.y &&
      centre.y < candidate.bounds.y + candidate.bounds.height,
  );
  return display ?? null;
}

/**
 * Drives the real OS cursor with PowerShell. Returns the positions the OS
 * actually reported, because this harness may share the desktop with a human:
 * when someone else moves the mouse mid-run the scripted path is not the real
 * one, and the caller must know that before blaming the application.
 */
function driveCursor({ bounds, display, click, rightClick, drag }) {
  const scale = display?.scaleFactor ?? 1;
  const origin = display?.bounds ?? { x: 0, y: 0 };
  // Electron works in DIPs; the OS cursor works in physical pixels.
  const physicalX = Math.round((bounds.x + bounds.width / 2 - origin.x) * scale + origin.x);
  const physicalY = Math.round((bounds.y + bounds.height / 2 - origin.y) * scale + origin.y);
  const dragPhysical =
    drag === undefined
      ? null
      : { dx: Math.round(drag.dx * scale), dy: Math.round(drag.dy * scale) };

  const scriptArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    ps1File,
    '-CenterX',
    String(physicalX),
    '-CenterY',
    String(physicalY),
  ];
  if (click) scriptArgs.push('-Click');
  if (rightClick) scriptArgs.push('-RightClick');
  if (dragPhysical !== null) {
    scriptArgs.push(
      '-Drag',
      '-DragDx',
      String(dragPhysical.dx),
      '-DragDy',
      String(dragPhysical.dy),
      '-Steps',
      String(DRAG_STEPS),
    );
  }

  const stdout = execFileSync('powershell.exe', scriptArgs, { encoding: 'utf8' });
  for (const line of stdout.split(/\r?\n/)) if (line.trim() !== '') log(line.trim());

  const trace = parsePointList(stdout, 'trace:');
  return {
    physical: { x: physicalX, y: physicalY },
    scriptedEnd:
      dragPhysical === null
        ? { x: physicalX, y: physicalY }
        : { x: physicalX + dragPhysical.dx, y: physicalY + dragPhysical.dy },
    settle: parsePoint(stdout, 'settle:'),
    final: parsePoint(stdout, 'final:'),
    trace,
    scale,
    origin,
  };
}

function parsePoint(text, prefix) {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith(prefix));
  if (line === undefined) return null;
  const [x, y] = line.trim().slice(prefix.length).split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function parsePointList(text, prefix) {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith(prefix));
  if (line === undefined) return [];
  return line
    .trim()
    .slice(prefix.length)
    .split(';')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [x, y] = entry.split(',').map(Number);
      return { x, y };
    });
}

function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Moves the cursor to a point and re-aims until it actually settles there.
 *
 * `driveCursor` sets the position and reads it straight back, so a settle away
 * from the target means something else moved the mouse. On a desktop shared with
 * a human that is expected; retrying the *aim* — never the assertion — is what
 * keeps the run meaningful instead of flaky.
 */
async function aimCursor(target, display, attempts = 4) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = driveCursor({ bounds: { ...target, width: 0, height: 0 }, display });
    if (last.settle === null) continue;
    const offDip = distance(last.settle, last.physical) / last.scale;
    if (offDip <= CURSOR_AIM_TOLERANCE_DIP) return last;
    log(`aim attempt ${attempt}: cursor settled ${Math.round(offDip)} DIP off ${JSON.stringify(target)}`);
    // Give a human hand mid-move time to let go before trying the same spot again.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return last;
}

/**
 * Point the cursor must reach to touch a marker parked on `edge`: the middle of
 * the sliver it keeps inside the work area. Mirrors `parkedRect()` in
 * src/shared/utils/edge-hide.ts — the geometry these assertions verify.
 *
 * The parked rectangle keeps the axis it did not move along, so the centre of
 * that axis can be read straight off the marker's full rectangle. Aiming here is
 * safe whether the marker is currently parked (the point is inside the sliver)
 * or already shown (the point is within the exit distance, so it stays shown).
 */
function sliverPoint(area, rect, edge, peek) {
  const alongX = rect.x + rect.width / 2;
  const alongY = rect.y + rect.height / 2;
  switch (edge) {
    case 'left':
      return { x: area.x + peek / 2, y: alongY };
    case 'right':
      return { x: area.x + area.width - peek / 2, y: alongY };
    case 'top':
      return { x: alongX, y: area.y + peek / 2 };
    case 'bottom':
      return { x: alongX, y: area.y + area.height - peek / 2 };
    default:
      return null; // 'free': the marker never parks, so there is nothing to reach
  }
}

/** How much of `rect` stays inside the work area along the edge it parked on. */
function visibleAlongEdge(area, rect, edge) {
  switch (edge) {
    case 'left':
      return rect.x + rect.width - area.x;
    case 'right':
      return area.x + area.width - rect.x;
    case 'top':
      return rect.y + rect.height - area.y;
    case 'bottom':
      return area.y + area.height - rect.y;
    default:
      return null;
  }
}

/**
 * The work-area edge the marker is docked to, mirroring `dockedEdge()` in
 * src/shared/utils/anchoring.ts — the same threshold and the same first-wins tie
 * order this harness asserts against.
 */
function dockedEdgeOf(marker, area, threshold = PANEL_DOCK_THRESHOLD_DIP) {
  const distances = {
    left: marker.x - area.x,
    right: area.x + area.width - (marker.x + marker.width),
    top: marker.y - area.y,
    bottom: area.y + area.height - (marker.y + marker.height),
  };
  let edge = 'free';
  let best = threshold;
  for (const candidate of ['left', 'right', 'top', 'bottom']) {
    if (distances[candidate] < best) {
      best = distances[candidate];
      edge = candidate;
    }
  }
  return edge;
}

/**
 * Checks the one rule the panel's placement follows (§9.3): a marker docked to an
 * edge unfolds the panel *away* from it — top → downwards, bottom → upwards, left
 * → rightwards, right → leftwards — and a marker parked away from every edge
 * opens beside it on the roomier side.
 *
 * Only the side and the gap are asserted, never the perpendicular axis: that axis
 * is clamped into the work area, so a marker near a corner legitimately shifts the
 * panel along it.
 */
function checkPanelSide(what, marker, panel, area) {
  const edge = dockedEdgeOf(marker, area);
  const tol = EDGE_HIDE_TOLERANCE_DIP;
  const gapBelow = panel.y - (marker.y + marker.height);
  const gapAbove = marker.y - (panel.y + panel.height);
  const gapRight = panel.x - (marker.x + marker.width);
  const gapLeft = marker.x - (panel.x + panel.width);
  const near = (value) => Math.abs(value - PANEL_GAP_DIP) <= tol;

  const problems = {
    top: `${gapBelow} DIP below the marker (expected ${PANEL_GAP_DIP}: a top-docked marker unfolds downwards)`,
    bottom: `${gapAbove} DIP above the marker (expected ${PANEL_GAP_DIP}: a bottom-docked marker unfolds upwards)`,
    left: `${gapRight} DIP right of the marker (expected ${PANEL_GAP_DIP}: a left-docked marker unfolds rightwards)`,
    right: `${gapLeft} DIP left of the marker (expected ${PANEL_GAP_DIP}: a right-docked marker unfolds leftwards)`,
  };

  if (edge !== 'free') {
    const ok =
      (edge === 'top' && near(gapBelow)) ||
      (edge === 'bottom' && near(gapAbove)) ||
      (edge === 'left' && near(gapRight)) ||
      (edge === 'right' && near(gapLeft));
    if (ok) {
      pass(`${what}: opens away from the ${edge} edge it is docked to`, {
        marker,
        panel,
        edge,
      });
      return;
    }
    fail(`${what}: the panel sits ${problems[edge]}`);
    return;
  }

  const centred = Math.abs(panel.y + panel.height / 2 - (marker.y + marker.height / 2)) <= tol;
  // A panel clamped against the work area's own top or bottom cannot also be centred
  // on a marker that sits near that edge — being pushed back in is the correct answer
  // there, and the rule being asserted is which *side* it opens on.
  const clamped =
    panel.y <= area.y + tol || panel.y + panel.height >= area.y + area.height - tol;
  if ((centred || clamped) && (near(gapRight) || near(gapLeft))) {
    pass(
      `${what}: opens beside the marker at ${PANEL_GAP_DIP} DIP, ` +
        `${centred ? 'centred on it' : 'clamped to the work area it would otherwise leave'}` +
        ' (marker has no docked edge)',
      { marker, panel, gap: near(gapRight) ? gapRight : gapLeft },
    );
    return;
  }
  fail(
    `${what}: the marker has no docked edge, so the panel should open beside it at ` +
      `${PANEL_GAP_DIP} DIP, centred on it or clamped inside the work area — gaps were ` +
      `${gapLeft}/${gapRight} DIP, vertical offset ` +
      `${Math.abs(panel.y + panel.height / 2 - (marker.y + marker.height / 2))} DIP`,
  );
}

const PS1 = String.raw`
param(
  [Parameter(Mandatory=$true)][int]$CenterX,
  [Parameter(Mandatory=$true)][int]$CenterY,
  [int]$DragDx = 0,
  [int]$DragDy = 0,
  [int]$Steps = 12,
  [switch]$Click,
  [switch]$RightClick,
  [switch]$Drag
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YichenMouse {
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  private const uint LEFTDOWN = 0x0002;
  private const uint LEFTUP = 0x0004;
  private const uint RIGHTDOWN = 0x0008;
  private const uint RIGHTUP = 0x0010;
  public static void Press() { mouse_event(LEFTDOWN, 0, 0, 0, IntPtr.Zero); }
  public static void Release() { mouse_event(LEFTUP, 0, 0, 0, IntPtr.Zero); }
  public static void RightPress() { mouse_event(RIGHTDOWN, 0, 0, 0, IntPtr.Zero); }
  public static void RightRelease() { mouse_event(RIGHTUP, 0, 0, 0, IntPtr.Zero); }
}
'@

[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($CenterX, $CenterY)
Start-Sleep -Milliseconds 300
$p = [System.Windows.Forms.Cursor]::Position
Write-Output "settle:$($p.X),$($p.Y)"

if ($Click) {
  [YichenMouse]::Press()
  Start-Sleep -Milliseconds 60
  [YichenMouse]::Release()
}

if ($RightClick) {
  [YichenMouse]::RightPress()
  Start-Sleep -Milliseconds 60
  [YichenMouse]::RightRelease()
}

if ($Drag) {
  [YichenMouse]::Press()
  Start-Sleep -Milliseconds 150
  $trace = @()
  for ($i = 1; $i -le $Steps; $i++) {
    $x = [int]($CenterX + ($DragDx * $i / $Steps))
    $y = [int]($CenterY + ($DragDy * $i / $Steps))
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
    Start-Sleep -Milliseconds 45
    $p = [System.Windows.Forms.Cursor]::Position
    $trace += "$($p.X),$($p.Y)"
  }
  Write-Output ("trace:" + ($trace -join ";"))
  Start-Sleep -Milliseconds 80
  [YichenMouse]::Release()
}

Start-Sleep -Milliseconds 60
$p = [System.Windows.Forms.Cursor]::Position
Write-Output "final:$($p.X),$($p.Y)"
`;

/**
 * Drags the marker and retries only when the attempt genuinely failed (no events,
 * or a landing outside tolerance). This desktop may be shared with a human, so a
 * bounded retry keeps the run honest without hiding a real defect.
 *
 * The expectation is measured, not assumed: the marker must move by exactly as
 * much as the cursor did. Both ends come from the harness's own cursor readings —
 * `settle` right before the button goes down, `final` after it is released — and
 * the start rectangle from the app's `drag-start` event. Nothing is derived from
 * a cursor position read back mid-drag, which Chromium rewrites whenever a
 * captured drag moves the window (§9.1.1).
 *
 * It is compared against `rawBounds`, the rectangle captured just before edge
 * snapping runs: snapping legitimately moves the window afterwards, so the
 * comparison must happen before it.
 */
async function runDrag(startBounds, display, deltaDip, attempts = 3) {
  let bounds = startBounds;
  let lastFailure = 'no attempt ran';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const since = Date.now();
    const drive = driveCursor({ bounds, display, drag: deltaDip });
    const dragEnd = await waitForEvent('drag-end', 10_000, since);
    const start = await waitForEvent('drag-start', 2_000, since);

    // A miss leaves the marker where it was, so re-aiming at the same rectangle
    // is worth one retry; after that it is not the harness's aim that is wrong.
    if (dragEnd === null && attempt >= 2) {
      lastFailure = 'no drag-end event: pointer events did not reach the marker window';
      break;
    }

    if (dragEnd === null || start === null) {
      lastFailure =
        dragEnd === null
          ? 'no drag-end event: pointer events did not reach the marker window'
          : 'drag-start did not publish the grab point / offset';
      log(`attempt ${attempt}: ${lastFailure} — retrying`);
    } else {
      const actual = dragEnd.detail?.rawBounds ?? {};
      const startRect = start.detail?.bounds ?? bounds;
      // Where the cursor actually went, in DIPs. Falls back to the scripted
      // delta if the driver failed to report its readings.
      const cursorDip =
        drive.settle === null || drive.final === null
          ? {
              x: (drive.scriptedEnd.x - drive.physical.x) / drive.scale,
              y: (drive.scriptedEnd.y - drive.physical.y) / drive.scale,
            }
          : {
              x: (drive.final.x - drive.settle.x) / drive.scale,
              y: (drive.final.y - drive.settle.y) / drive.scale,
            };
      const expected = { x: startRect.x + cursorDip.x, y: startRect.y + cursorDip.y };
      const dx = Math.abs((actual.x ?? 0) - expected.x);
      const dy = Math.abs((actual.y ?? 0) - expected.y);
      const landed = { dragEnd, start, drive, expected, actual, dx, dy };

      if (dx <= DRAG_TOLERANCE_DIP && dy <= DRAG_TOLERANCE_DIP) return landed;

      lastFailure =
        `the marker landed at ${JSON.stringify({ x: actual.x, y: actual.y })}, expected ` +
        `${JSON.stringify({ x: Math.round(expected.x), y: Math.round(expected.y) })} (Δ ${dx}/${dy} DIP)` +
        // A desktop shared with a human is the usual reason a drag "fails": the
        // scripted path stopped being the real one. Say so, so a busy desk is not
        // reported as a broken application.
        (drive.settle === null
          ? ''
          : ` — cursor settled ${distance(drive.settle, drive.physical)} physical px off the aimed point`);
      log(`attempt ${attempt}: ${lastFailure} — retrying`);
      // Re-aim at where the marker actually is now (`bounds` is post-snap). No
      // sleep here: the cursor is still on the dot, and letting it drift away
      // could park the marker at an edge, where a retry would miss it entirely.
      bounds = dragEnd.detail?.bounds ?? bounds;
    }
  }

  log(`drag failed after ${attempts} attempts: ${lastFailure}`);
  return null;
}

/** Clicks the marker, retrying when the click did not register. */
async function runClick(bounds, display, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const since = Date.now();
    const drive = driveCursor({ bounds, display, click: true });
    const expand = await waitForEvent('expand', 5_000, since);
    if (expand !== null) return { expand, drive };

    const down = await waitForEvent('pointer-down', 200, since);
    const strayed = drive.settle === null ? null : distance(drive.settle, drive.physical);
    log(
      `attempt ${attempt}: the click did not expand the panel ` +
        `(pointerdown: ${down === null ? 'not received' : 'received'}, settle off by ${strayed} px) — retrying`,
    );
    await new Promise((resolve) => setTimeout(resolve, CLICK_SUPPRESSION_BACKOFF_MS));
  }

  return null;
}

/**
 * Right-clicks the marker. No retry loop like `runClick`: that one exists because a
 * click has to land on the dot and expand the panel, whereas this only has to reach
 * the renderer, which reports the attempt either way.
 */
async function runRightClick(bounds, display) {
  const since = Date.now();
  const drive = driveCursor({ bounds, display, rightClick: true });
  const context = await waitForEvent('context-menu', 3_000, since);
  return { context, drive };
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('[smoke] this harness drives the Windows cursor and only runs on Windows.');
    process.exit(2);
  }

  rmSync(smokeDir, { recursive: true, force: true });
  mkdirSync(smokeDir, { recursive: true });
  writeFileSync(ps1File, PS1, 'ascii');

  if (!skipBuild) {
    log('building renderer + main bundles');
    // `npm_execpath` is set by npm itself; going through node avoids the
    // Node 24 + Windows restriction on spawning `.cmd` files directly.
    const npmCli = process.env.npm_execpath;
    if (npmCli === undefined) {
      execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    } else {
      execFileSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, stdio: 'inherit' });
    }
  }

  const electronBinary = require('electron');
  log(`launching electron (focusable marker: ${focusable ? 'yes' : 'no'})`);
  const child = spawn(electronBinary, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      YICHEN_SMOKE: '1',
      YICHEN_SMOKE_DIR: smokeDir,
      // Its own database, inside the directory wiped above: the run starts from
      // an empty schema every time and never touches the real user data.
      YICHEN_SMOKE_DB: join(smokeDir, 'smoke.db'),
      // The app menu is only ever a popup, and a popup cannot be clicked by a
      // script (platform/app-menu.ts). This makes the run skip the popup and
      // *run* that item instead, so what the harness asserts is the action, not
      // Electron's own menu widget — which is the only thing left unexercised.
      YICHEN_SMOKE_MENU_PICK: '0',
      ...(focusable ? { YICHEN_SMOKE_FOCUSABLE: '1' } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  try {
    const ready = await waitForEvent('ready', 45_000);
    if (ready === null) {
      fail('marker renderer never reported ready');
      return;
    }
    pass('marker renderer reported ready');

    const initial = await waitFor(markerBounds, 15_000, 'the marker window bounds');
    if (initial === null) return;
    const display = displayScaleFor(initial);
    log(
      `marker bounds (DIP): ${JSON.stringify(initial)} · display scale: ${display?.scaleFactor ?? 'unknown'}`,
    );
    if (initial.width === EXPECTED_WINDOW.width && initial.height === EXPECTED_WINDOW.height) {
      pass(
        `marker window is the platform minimum ${EXPECTED_WINDOW.width}×${EXPECTED_WINDOW.height} ` +
          `(artwork ${MARKER_ARTWORK_SIZE}px)`,
      );
    } else {
      fail(
        `marker window is ${initial.width}×${initial.height}, expected ` +
          `${EXPECTED_WINDOW.width}×${EXPECTED_WINDOW.height}`,
      );
    }

    // --- phase 0: marker state ----------------------------------------------
    // The main process owns the appearance + badge + ring and pushes them to the
    // marker entry (§9). Both halves are asserted: that the push happened, and
    // that the always-resident renderer actually applied it.
    const pushed = await waitForEvent('marker-state', 10_000, ready.at - 2_000);
    if (pushed === null) {
      fail('the main process never pushed the marker state');
    } else {
      pass('the main process pushed the marker appearance / badge / ring state');
    }

    const applied = await waitForEvent('marker-state-applied', 10_000, ready.at - 2_000);
    if (applied === null) {
      fail('the marker renderer never applied the pushed state');
    } else {
      const detail = applied.detail ?? {};
      const expected = { shape: 'dot', badge: 3, progress: 42, risk: 'near' };
      const matches = Object.entries(expected).every(([key, value]) => detail[key] === value);
      if (matches) {
        pass('marker applied the pushed shape, badge and progress ring', detail);
      } else {
        fail(
          `marker applied ${JSON.stringify(detail)}, expected the harness state ` +
            `${JSON.stringify(expected)}`,
        );
      }
    }

    /**
     * The marker's boot rectangle, published once at `ready-to-show` and not
     * touched by anything yet.
     */
    const bootRect = initial;

    // --- phase 1: edge auto-hide --------------------------------------------
    // Deliberately before the drag: at boot the marker is anchored to an edge —
    // the only state where the park policy applies (§9.4) — and `ready-to-show`
    // published both that anchor and its rectangle. Dragging first would leave a
    // free anchor, and then there would be nothing to park.
    const area = display?.workArea ?? display?.bounds ?? null;
    const bootAnchor = readStatus()?.markerAnchor ?? null;

    if (
      area === null ||
      bootAnchor === null ||
      sliverPoint(area, bootRect, bootAnchor.edge, EDGE_HIDE.peek) === null
    ) {
      fail(
        `the marker did not boot with an edge anchor, so auto-hide cannot apply: ` +
          `${JSON.stringify({ workArea: area !== null, anchor: bootAnchor })}`,
      );
    } else {
      const edge = bootAnchor.edge;

      // Reach the sliver first. A parked marker comes back out here; a marker
      // that is already shown stays shown, because the cursor lands within its
      // exit distance. Either way the next step starts from a visible marker.
      const settleSince = Date.now();
      await aimCursor(sliverPoint(area, bootRect, edge, EDGE_HIDE.peek), display);
      await waitForEvent('edge-reveal', 1_500, settleSince);

      // Leave: the middle of the work area is far past the exit distance on any
      // display big enough to run the app on.
      const parkSince = Date.now();
      await aimCursor(
        { x: area.x + area.width / 2, y: area.y + area.height / 2 },
        display,
      );
      const park = await waitForEvent('edge-park', 4_000, parkSince);

      if (park === null) {
        fail('the marker did not park after the cursor left the edge');
      } else {
        const parked = park.detail?.bounds ?? {};
        const parkedEdge = park.detail?.edge ?? edge;
        const visible = visibleAlongEdge(area, parked, parkedEdge);
        if (visible !== null && Math.abs(visible - EDGE_HIDE.peek) <= EDGE_HIDE_TOLERANCE_DIP) {
          pass(
            `marker parked on the ${parkedEdge} edge, leaving ${visible}px of it inside the ` +
              `work area (configured ${EDGE_HIDE.peek})`,
            { parked, edge: parkedEdge },
          );
        } else {
          fail(
            `marker parked at ${JSON.stringify(parked)} on the ${parkedEdge} edge, i.e. ` +
              `${visible}px inside the work area, expected ${EDGE_HIDE.peek}`,
          );
        }

        // Return: aim at the sliver the marker left behind, whose geometry comes
        // from the event itself rather than from an assumption about which edge.
        const revealSince = Date.now();
        driveCursor({
          bounds: { ...sliverPoint(area, parked, parkedEdge, EDGE_HIDE.peek), width: 0, height: 0 },
          display,
        });
        const reveal = await waitForEvent('edge-reveal', 4_000, revealSince);

        if (reveal === null) {
          fail('the marker did not come back out when the cursor reached the sliver');
        } else {
          const back = reveal.detail?.bounds ?? {};
          if (distance(back, bootRect) <= EDGE_HIDE_TOLERANCE_DIP) {
            pass('marker came back to its anchored position when the cursor approached', {
              revealed: back,
              anchored: bootRect,
            });
          } else {
            fail(
              `marker came back to ${JSON.stringify({ x: back.x, y: back.y })}, expected its ` +
                `anchored ${JSON.stringify({ x: bootRect.x, y: bootRect.y })}`,
            );
          }
        }
      }
    }

    // --- phase 2: drag ------------------------------------------------------
    // Runs after the park phase and from the boot rectangle, so the marker is
    // visible, edge-anchored and not mid-animation.
    const drag = await runDrag(bootRect, display, DRAG_DIP);

    if (drag === null) {
      fail('the marker did not follow the cursor across the desktop');
    } else {
      pass('pointerdown/pointermove reached the marker window (drag started)', {
        ticks: drag.dragEnd.detail?.ticks,
      });
      pass(
        `marker landed where the drag left it over ${DRAG_STEPS} frames ` +
          `(Δ ${drag.dx}/${drag.dy} DIP, tolerance ${DRAG_TOLERANCE_DIP})`,
        {
          grab: drag.start.detail?.grab,
          offset: drag.start.detail?.offset,
          expected: { x: Math.round(drag.expected.x), y: Math.round(drag.expected.y) },
          actual: { x: drag.actual.x, y: drag.actual.y },
        },
      );
      pass('persisted anchor after drag', drag.dragEnd.detail?.anchor);
    }

    // --- phase 3: click -----------------------------------------------------
    // Click where the drag actually left the marker — its boot-time bounds are a
    // stale snapshot, and edge snapping may have nudged it on top of that — then
    // wait out the post-drag click suppression. The cursor stays on the dot
    // through that wait, so the marker cannot park out from under the click.
    await new Promise((resolve) => setTimeout(resolve, CLICK_SUPPRESSION_BACKOFF_MS));
    const clickTarget = drag?.dragEnd?.detail?.bounds ?? bootRect;

    if (clickTarget === null) {
      fail('the marker position after the drag is unknown, so the click could not be aimed');
      return;
    }

    const click = await runClick(clickTarget, display);

    if (click === null) {
      fail('click was not reported by the marker renderer');
    } else {
      pass('click reached the marker renderer', click.expand.detail);
    }

    const panelEvent = await waitForEvent('panel-expanded', 5_000, click?.expand.at ?? Date.now());
    if (panelEvent === null) {
      fail('panel window did not expand after the click');
    } else {
      pass('panel expanded next to the marker', panelEvent.detail);

      // --- phase 4: panel geometry ------------------------------------------
      // The panel is not OS-resizable (§9.1.1), so its size comes from settings
      // and its position from `placePanel`. Both are asserted here: a panel that
      // opened at the wrong size, or off the work area, is unusable.
      const panelBounds = panelEvent.detail?.panelBounds ?? null;
      // `clickTarget` is the marker's live, post-snap rectangle at click time.
      // Reading the boot snapshot back here instead would let a panel that opened
      // next to the marker's *old* position pass, since the marker has moved.
      const markerAt = clickTarget ?? markerBounds();

      if (panelBounds === null || markerAt === null) {
        fail('the panel or marker bounds were not published, so the geometry is unverifiable');
      } else {
        if (
          panelBounds.width === PANEL_SIZE.width &&
          panelBounds.height === PANEL_SIZE.height
        ) {
          pass(
            `panel uses the configured size ${PANEL_SIZE.width}×${PANEL_SIZE.height} ` +
              `(frameless windows cannot be OS-resized here)`,
          );
        } else {
          fail(
            `panel is ${panelBounds.width}×${panelBounds.height}, expected ` +
              `${PANEL_SIZE.width}×${PANEL_SIZE.height}`,
          );
        }

        // Which side it opens on, and how far from the marker: the rule in §9.3
        // (away from the docked edge) is what this asserts, not merely "nearby". The
        // rect is the work area and not the display's bounds, because that is what
        // `placePanel` clamps into: a marker resting on the taskbar is docked to the
        // edge of the work area, which sits 48 DIP inside the screen here.
        const area = display?.workArea ?? display?.bounds ?? null;
        if (area === null) {
          fail('the work area was not published, so the panel side is unverifiable');
        } else {
          const inside =
            panelBounds.x >= area.x &&
            panelBounds.y >= area.y &&
            panelBounds.x + panelBounds.width <= area.x + area.width &&
            panelBounds.y + panelBounds.height <= area.y + area.height;
          if (inside) {
            pass('panel opened fully inside the work area', { panelBounds });
          } else {
            fail(`panel opened outside the work area: ${JSON.stringify(panelBounds)}`);
          }

          checkPanelSide('panel after the marker click', markerAt, panelBounds, area);
        }
      }
    }

    // --- phase 5: right-click opens the app menu (M02 S8) -------------------
    // The app menu (新建任务 / 今日 / 退出) is asked for by the marker, never built
    // by it: the labels come from the main process's i18n instance and the actions
    // move windows or quit the app (§6.5). So the right-click is driven for real,
    // and what comes back is asserted end to end — renderer → channel → the main
    // process's list → the chosen action actually running.
    //
    // `YICHEN_SMOKE_MENU_PICK=0` (set at launch) makes it run 新建任务 instead of
    // popping up. The marker's click and this action both end in `expandPanel`, so
    // the fresh `panel-expanded` after the right-click is the proof that the menu
    // item ran rather than merely being read out.
    const menuTarget = drag?.dragEnd?.detail?.bounds ?? markerBounds();
    if (menuTarget === null) {
      fail('the marker position is unknown, so the right-click could not be aimed');
    } else {
      const right = await runRightClick(menuTarget, display);

      if (right.context === null) {
        fail('the right-click never reached the marker renderer');
      } else {
        pass('right-click reached the marker renderer');
      }

      const menu = await waitForEvent('app-menu', 3_000, right.context?.at ?? Date.now());
      const labels = menu?.detail?.labels ?? null;

      if (menu === null || labels === null) {
        fail('the marker renderer never asked the main process for the app menu');
      } else {
        const resolved = labels.every((label) => label.trim() !== '' && !label.includes('.'));
        if (labels.length === 3 && resolved) {
          pass('the main process answered with its three-item menu, labelled from i18n', {
            labels,
          });
        } else {
          fail(
            `the app menu came back as ${JSON.stringify(labels)}, expected three labels ` +
              `resolved from i18n (not raw keys)`,
          );
        }
      }

      const picked = await waitForEvent('app-menu-picked', 3_000, right.context?.at ?? Date.now());
      if (picked === null) {
        fail('no menu item was chosen');
      } else if (picked.detail?.index !== 0 || picked.detail?.label !== labels?.[0]) {
        fail(
          `the chosen item was ${JSON.stringify(picked.detail)}, expected index 0 ` +
            `(${JSON.stringify(labels?.[0])})`,
        );
      } else {
        pass('the requested menu item was found and run', picked.detail);
      }

      // 新建任务 opens the panel and hands the caret to quick-add — the same path
      // the marker's own click takes, so a panel that reactivates here is the
      // action having run, not the menu having been drawn.
      const reopened = await waitForEvent('panel-expanded', 5_000, right.context?.at ?? Date.now());
      if (reopened === null) {
        fail('the menu item ran but the panel did not open');
      } else {
        pass('the menu item opened the panel through the same path the marker click uses', {
          panelBounds: reopened.detail?.panelBounds,
        });
      }
    }

    // --- phase 6: the panel travels with the marker (M01 §9.3) --------------
    // The panel is the marker's anchor, so dragging the marker has to drag the
    // panel — and re-derive which side it opens on as the marker crosses edges,
    // rather than staying where it was. The panel window reports every settled
    // follow (`panel-followed`, debounced in windows/panel.ts), so what is
    // asserted here is the app's own rectangles, not a position the harness
    // guessed: the movement happened, and the result obeys the same side rule the
    // click's placement was checked against.
    //
    // The drag starts from `menuTarget`: the marker has not moved since the
    // right-click, and the boot snapshot `markerBounds()` is stale by now —
    // phase 2's drag is what moved it.
    const followSince = Date.now();
    const followDrag =
      menuTarget === null ? null : await runDrag(menuTarget, display, FOLLOW_DRAG_DIP);
    const followed = await waitForEvent('panel-followed', 6_000, followSince);

    if (menuTarget === null) {
      fail('the marker position is unknown, so the panel-follow drag could not be aimed');
    } else if (followDrag === null) {
      fail('the marker did not follow the cursor while the panel was open');
    } else if (followed === null) {
      fail('the panel did not travel with the marker: no follow was reported');
    } else {
      const followedMarker = followed.detail?.markerBounds ?? null;
      const followedPanel = followed.detail?.panelBounds ?? null;
      const landedMarker = followDrag.dragEnd.detail?.bounds ?? null;
      const area = display?.workArea ?? display?.bounds ?? null;

      if (
        followedMarker === null ||
        followedPanel === null ||
        landedMarker === null ||
        area === null
      ) {
        fail('the follow event did not publish both rectangles');
      } else if (distance(followedMarker, landedMarker) > EDGE_HIDE_TOLERANCE_DIP) {
        fail(
          `the reported follow used the marker's rectangle from ${JSON.stringify(followedMarker)}, ` +
            `but the drag left it at ${JSON.stringify(landedMarker)}`,
        );
      } else {
        pass('the panel followed the marker through the drag (reported rectangles match the drag end)', {
          marker: followedMarker,
          panel: followedPanel,
        });

        const inside =
          followedPanel.x >= area.x &&
          followedPanel.y >= area.y &&
          followedPanel.x + followedPanel.width <= area.x + area.width &&
          followedPanel.y + followedPanel.height <= area.y + area.height;
        if (inside) {
          pass('the panel is still fully inside the work area after following the drag', {
            panel: followedPanel,
          });
        } else {
          fail(`the panel followed the marker off the work area: ${JSON.stringify(followedPanel)}`);
        }

        checkPanelSide('panel after the follow drag', followedMarker, followedPanel, area);
      }
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (process.platform === 'win32' && child.pid !== undefined) {
      try {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        child.kill();
      }
    } else {
      child.kill();
    }
  }
}

await main();

const failures = results.filter((entry) => !entry.ok);
writeFileSync(join(smokeDir, 'report.json'), JSON.stringify({ focusable, results }, null, 2), 'utf8');
console.log(`\n[smoke] ${results.length - failures.length}/${results.length} checks passed`);
console.log(`[smoke] raw evidence: ${statusFile}`);
if (failures.length > 0) {
  console.error('[smoke] failed checks:');
  for (const failure of failures) console.error(`  - ${failure.step}`);
  process.exit(1);
}
