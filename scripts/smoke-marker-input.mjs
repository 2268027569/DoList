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
 * PowerShell (`mouse_event`), and checks what the renderers reported.
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
const dragDxPhysical = -220;
const dragDyPhysical = 160;
/**
 * Drag in many small steps. A short drag cannot distinguish "the loop lands in
 * the right place" from "the loop accumulates a little error each frame", and
 * the cursor warp (§9.1.1) is a per-frame effect, so the step count is what
 * makes this assertion meaningful.
 */
const DRAG_STEPS = 30;
/** Position tolerance for the drag assertion, in DIPs. */
const DRAG_TOLERANCE_DIP = 6;

/** Artwork size of the dot; the *window* is bigger where the OS demands it. */
const MARKER_ARTWORK_SIZE = 28;
/**
 * Windows inflates a transparent frameless top-level window to at least 32×39
 * DIPs — measured, see docs/ARCHITECTURE.md §9.1. The original plan assumed the
 * requested 28×28 would be honoured; it is not.
 */
const EXPECTED_WINDOW = { width: 32, height: 39 };
/** The renderer swallows clicks for 300ms after a drag (§9.2). */
const CLICK_SUPPRESSION_BACKOFF_MS = 450;

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
function driveCursor({ bounds, display, click, drag }) {
  const scale = display?.scaleFactor ?? 1;
  const origin = display?.bounds ?? { x: 0, y: 0 };
  // Electron works in DIPs; the OS cursor works in physical pixels.
  const physicalX = Math.round((bounds.x + bounds.width / 2 - origin.x) * scale + origin.x);
  const physicalY = Math.round((bounds.y + bounds.height / 2 - origin.y) * scale + origin.y);

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
  if (drag) {
    scriptArgs.push(
      '-Drag',
      '-DragDx',
      String(dragDxPhysical),
      '-DragDy',
      String(dragDyPhysical),
      '-Steps',
      String(DRAG_STEPS),
    );
  }

  const stdout = execFileSync('powershell.exe', scriptArgs, { encoding: 'utf8' });
  for (const line of stdout.split(/\r?\n/)) if (line.trim() !== '') log(line.trim());

  const trace = parsePointList(stdout, 'trace:');
  return {
    physical: { x: physicalX, y: physicalY },
    scriptedEnd: drag
      ? { x: physicalX + dragDxPhysical, y: physicalY + dragDyPhysical }
      : { x: physicalX, y: physicalY },
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

const PS1 = String.raw`
param(
  [Parameter(Mandatory=$true)][int]$CenterX,
  [Parameter(Mandatory=$true)][int]$CenterY,
  [int]$DragDx = 0,
  [int]$DragDy = 0,
  [int]$Steps = 12,
  [switch]$Click,
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
  public static void Press() { mouse_event(LEFTDOWN, 0, 0, 0, IntPtr.Zero); }
  public static void Release() { mouse_event(LEFTUP, 0, 0, 0, IntPtr.Zero); }
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
 * The expectation is the *end-to-end* claim: dragging the dot by N pixels must
 * leave it exactly N pixels away from where it started. It is built from the
 * scripted cursor path and the window bounds at the start of the attempt — never
 * from the cursor position read back mid-drag, which Chromium rewrites whenever a
 * captured drag moves the window (§9.1.1) and which would therefore accept a
 * wrong landing as "expected".
 */
async function runDrag(startBounds, display, attempts = 3) {
  let bounds = startBounds;
  let lastFailure = 'no attempt ran';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const since = Date.now();
    const drive = driveCursor({ bounds, display, drag: true });
    const dragEnd = await waitForEvent('drag-end', 10_000, since);
    const start = await waitForEvent('drag-start', 2_000, since);

    if (dragEnd === null) {
      lastFailure = 'no drag-end event: pointer events did not reach the marker window';
      log(`attempt ${attempt}: ${lastFailure} — retrying`);
    } else if (start === null) {
      lastFailure = 'drag-start did not publish the grab point / offset';
      log(`attempt ${attempt}: ${lastFailure} — retrying`);
    } else {
      const actual = dragEnd.detail?.rawBounds ?? {};
      const netDip = {
        x: (drive.scriptedEnd.x - drive.physical.x) / drive.scale,
        y: (drive.scriptedEnd.y - drive.physical.y) / drive.scale,
      };
      const expected = { x: bounds.x + netDip.x, y: bounds.y + netDip.y };
      const dx = Math.abs((actual.x ?? 0) - expected.x);
      const dy = Math.abs((actual.y ?? 0) - expected.y);
      const landed = { dragEnd, start, drive, bounds, expected, actual, dx, dy };

      if (dx <= DRAG_TOLERANCE_DIP && dy <= DRAG_TOLERANCE_DIP) return landed;

      lastFailure =
        `the marker landed at ${JSON.stringify({ x: actual.x, y: actual.y })}, expected ` +
        `${JSON.stringify({ x: Math.round(expected.x), y: Math.round(expected.y) })} (Δ ${dx}/${dy} DIP)`;
      log(`attempt ${attempt}: ${lastFailure} — retrying`);
      bounds = dragEnd.detail?.bounds ?? bounds;
    }

    await new Promise((resolve) => setTimeout(resolve, CLICK_SUPPRESSION_BACKOFF_MS));
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

    // --- phase 1: drag ------------------------------------------------------
    const drag = await runDrag(initial, display);

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

    // --- phase 2: click -----------------------------------------------------
    // Click where the drag actually left the marker — its boot-time bounds are a
    // stale snapshot, and edge snapping may have nudged it on top of that — then
    // wait out the post-drag click suppression.
    await new Promise((resolve) => setTimeout(resolve, CLICK_SUPPRESSION_BACKOFF_MS));
    const clickTarget = drag?.dragEnd.detail?.bounds ?? markerBounds();

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
