/**
 * Quick-add smoke harness (docs/ARCHITECTURE.md §13; M02-PLAN §8, slice S3).
 *
 * Answers the question the unit tests cannot: does a task added through the
 * panel's quick-add field land in the database, come back through
 * `event:task-changed`, and get drawn by the panel? It asserts the whole chain
 * rather than a screenshot:
 *
 *   1. the panel renderer reports its first query (an empty Inbox),
 *   2. the real global shortcut opens the panel and hands the caret to its field,
 *   3. a title typed into the quick-add field, then Enter, creates a task,
 *   4. the main process announces it (`task-changed`, with the badge it recomputed),
 *   5. the panel re-fetches and re-draws (`tasks-rendered`),
 *   6. the row is actually in SQLite — read straight from the smoke database,
 *   7. the detail view opens on that row and its due date and priority are changed
 *      (slice S4),
 *   8. the row is moved with Alt+↓, moved back with Alt+↑, and moved down again by
 *      dragging its grip over the row below it (slice S5),
 *   9. a checklist item and a "Daily" repeat are set on that row (slice S6),
 *  10. a fresh launch reads those same values and that same order back off the disk,
 *      and
 *  11. ticking the repeating task off mints its next occurrence, which the list then
 *      draws in the place the completed row had occupied (slice S6).
 *
 * Only two things come from the OS: the global shortcut, which a registered hotkey
 * only ever sees when the input queue produced it, and the app's own launch. Every
 * other keystroke — and the drag — is delivered to the panel page over the DevTools
 * protocol, which is explained where the client is built below.
 *
 * The run touches neither the cursor nor the foreground window: an injected click
 * only lends the panel a foreground the injecting console takes back, which the
 * panel then reads as a user walking away. The marker's own click path is covered
 * by the marker harness instead.
 *
 * `YICHEN_SMOKE_DIR` and `YICHEN_SMOKE_DB` keep the run off the real profile: the
 * database starts empty every time.
 *
 * Usage:
 *   npm run smoke:tasks            # builds first
 *   npm run smoke:tasks -- --no-build
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const smokeDir = process.env.YICHEN_SMOKE_DIR ?? join(tmpdir(), 'yichen-todo-smoke-tasks');
/** Reassigned when the run relaunches the app on the same database (phase 5). */
let statusFile = join(smokeDir, 'status.json');
const ps1File = join(smokeDir, 'drive-input.ps1');
const databaseFile = join(smokeDir, 'smoke.db');

const skipBuild = process.argv.includes('--no-build');

/** Sent as Unicode code points, so no `SendKeys` metacharacter can get in the way. */
const FIRST_TASK = 'Buy milk';
const SECOND_TASK = 'Call the vet';
/** The checklist item added to the first task, and the day the repeat rolls onto. */
const SUBTASK = 'Take the big bag';

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

/** The most recent event of `type` recorded at or after `since`. */
async function waitForEvent(type, timeoutMs, since = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = readStatus()?.events?.find((entry) => entry.type === type && entry.at >= since);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

/**
 * The one keystroke that has to come from the OS.
 *
 * A registered global shortcut is only ever fired for input the OS input queue
 * produced, so the chord that opens the panel cannot be sent over the DevTools
 * protocol — the app would never see it.
 */
function sendHotkey(hotkey, compileCheck) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File];
  if (compileCheck === true) args.push('-CompileCheck');
  else args.push('-Hotkey', hotkey);

  // stderr is carried through rather than dropped: PowerShell reports a failure to
  // compile the helper there while still exiting 0, and a helper that silently did
  // nothing would be read as the app ignoring the shortcut.
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  for (const line of stdout.split(/\r?\n/)) if (line.trim() !== '') log(line.trim());
  if (stderr.trim() !== '') {
    for (const line of stderr.split(/\r?\n/)) if (line.trim() !== '') log(`[ps] ${line.trim()}`);
  }
  return { stdout, stderr };
}

/**
 * The panel's DOM over the DevTools protocol.
 *
 * A smoke run is its own process and has no way to call into the app, so the panel
 * used to be driven through the OS: keys were posted to its window, and text had to
 * skip the OS input queue because an IME in a composing mode rewrote it. That route
 * cannot move focus: Chromium treats focus navigation as its own job and honours it
 * only while the window really holds the foreground, which a scripted run never
 * has — so Tab produced no focus change, the harness pressed Tab a fixed number of
 * times anyway, and the Enter that followed landed on whatever was still focused
 * (twice marking a task done instead of opening it).
 *
 * The protocol fixes the root cause rather than the symptom: the harness attaches
 * to the panel page and addresses a control by the name the panel gives it, with
 * keys delivered to the renderer directly. No OS input queue, no IME, no foreground
 * window, and no counting. `--remote-debugging-port` is opened only under
 * `YICHEN_SMOKE` (main/index.ts), so a real install has no debug listener at all.
 */
const CDP_PORT = process.env.YICHEN_SMOKE_CDP_PORT ?? '9222';

/** The panel page's debugger address, retried while the app is still coming up. */
async function panelTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const panel = targets.find(
        (entry) => entry.type === 'page' && entry.url.split('?')[0].endsWith('/panel/index.html'),
      );
      if (panel !== undefined) return panel;
    } catch {
      // The port is not listening yet; the app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/** Attaches to the panel page and returns a client, or `null` if it never appeared. */
async function attachPanel(timeoutMs = 20_000) {
  const target = await panelTarget(timeoutMs);
  if (target === null) return null;

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('the panel socket refused')), {
      once: true,
    });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => socket.close() };
}

/** Runs an expression in the panel page and returns its value. */
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text ?? 'the panel expression threw');
  }
  return result.result.value;
}

/**
 * Puts the keyboard on a control by the name the panel gives it, and reports the
 * name it landed on. `taskId` narrows a name to one row when the list has several.
 */
async function focusField(cdp, field, taskId = null) {
  const landed = await evaluate(
    cdp,
    `(() => {
       const wanted = ${JSON.stringify(field)};
       const taskId = ${JSON.stringify(taskId)};
       const candidates = [...document.querySelectorAll('[data-field="' + wanted + '"]')];
       const node = taskId === null ? candidates[0] : candidates.find((each) => each.dataset.taskId === taskId);
       if (node === undefined) return null;
       node.focus();
       return node === document.activeElement ? node.dataset.field : null;
     })()`,
  );
  return landed;
}

/** Where the caret is now, by field name — the panel's own answer, not a guess. */
async function activeField(cdp) {
  return evaluate(
    cdp,
    `(document.activeElement && document.activeElement.dataset
        ? document.activeElement.dataset.field || null
        : null)`,
  );
}

/**
 * The keys this harness knows, with the virtual codes and — for Enter — the
 * character Chromium needs to run the same default action a typed one would
 * (activating a button, submitting through a field).
 */
const KEYS = {
  Enter: { code: 'Enter', virtualKey: 13, text: '\r' },
  Tab: { code: 'Tab', virtualKey: 9 },
  Escape: { code: 'Escape', virtualKey: 27 },
  ArrowUp: { code: 'ArrowUp', virtualKey: 38 },
  ArrowDown: { code: 'ArrowDown', virtualKey: 40 },
};

/** The protocol's modifier bit mask; only Alt is needed, by the reorder shortcut. */
const ALT = 1;

/** A key press delivered by the renderer itself, so no OS queue is involved. */
async function pressKey(cdp, key, modifiers = 0) {
  const spec = KEYS[key];
  if (spec === undefined) throw new Error(`the harness has no key spec for "${key}"`);

  const base = {
    key,
    code: spec.code,
    windowsVirtualKeyCode: spec.virtualKey,
    nativeVirtualKeyCode: spec.virtualKey,
    modifiers,
  };
  const withText =
    spec.text === undefined ? base : { ...base, text: spec.text, unmodifiedText: spec.text };

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...withText });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/**
 * Runs some JavaScript in the panel page and requires a truthy answer, so a step
 * that could not be set up at all is reported as a failed check rather than as an
 * application that ignored its input.
 */
async function requireEval(cdp, expression, description) {
  const value = await evaluate(cdp, expression);
  if (value === null || value === undefined || value === false) {
    fail(`could not ${description}`);
    return null;
  }
  return value;
}

/** Types text as key events: no IME can compose it and no queue can swallow it. */
async function typeText(cdp, text) {
  for (const character of text) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: character,
      code: character,
      text: character,
      unmodifiedText: character,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character, code: character });
  }
}

/**
 * The rows a view would draw, read straight out of the smoke database (WAL, so a
 * read is safe).
 *
 * `topLevel` is the default because that is what the Inbox query is: `sort_order`
 * is a **group** sequence, so ordering a mix of parents and subtasks by it would
 * sort two groups into each other.
 */
function readTasks(scope = 'topLevel') {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    const where = scope === 'topLevel' ? 'parent_id IS NULL' : scope === 'subtasks' ? 'parent_id IS NOT NULL' : '1 = 1';
    return db
      .prepare(
        'SELECT id, title, status, priority, due_at AS dueAt, due_has_time AS dueHasTime, ' +
          'list_id AS listId, parent_id AS parentId, repeat_rule AS repeatRule, ' +
          'repeat_mode AS repeatMode, deleted_at AS deletedAt ' +
          `FROM tasks WHERE ${where} ORDER BY sort_order ASC, created_at ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

/** Local midnight `offsetDays` from today, worked out the way the panel's presets do. */
function dayStart(offsetDays) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** Starts the app against a smoke profile; the panel opens on its own DB. */
function launchApp(electronBinary, dir) {
  return spawn(electronBinary, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      YICHEN_SMOKE: '1',
      YICHEN_SMOKE_DIR: dir,
      YICHEN_SMOKE_DB: databaseFile,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/** Kills the app process and the panel it spawned, on either platform. */
function stopApp(child) {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch {
      // Taskkill not finding it just means it was already gone; fall through to the
      // platform-neutral kill so the harness never leaves a process behind.
    }
  }
  child.kill();
}

const PS1 = String.raw`
param(
  [string]$Hotkey = '',
  [switch]$CompileCheck
)

Add-Type -AssemblyName System.Windows.Forms

if (-not ('YichenInput' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class YichenInput {
  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  private struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

  [StructLayout(LayoutKind.Explicit)]
  private struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT { public uint type; public INPUTUNION u; }

  [DllImport("user32.dll")] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  private const uint KEYBOARD = 1;
  private const uint KEYUP = 0x0002;
  // The left-hand virtual keys, not the generic ones: the generic VK_CONTROL /
  // VK_SHIFT name "either side", so a down/up pair sent with them can leave the
  // left-hand bit set in the keyboard state.
  private const ushort VK_CONTROL = 0xA2;
  private const ushort VK_SHIFT = 0xA0;
  private const ushort VK_MENU = 0xA4;
  private const ushort VK_LWIN = 0x5B;

  private static void Send(INPUT input) {
    INPUT[] batch = new INPUT[1];
    batch[0] = input;
    SendInput(1, batch, Marshal.SizeOf(typeof(INPUT)));
  }

  private static void WithVirtualKey(ushort vk, bool down) {
    INPUT input = new INPUT();
    input.type = KEYBOARD;
    input.u.ki.wVk = vk;
    input.u.ki.dwFlags = down ? 0 : KEYUP;
    Send(input);
  }

  // A registered global shortcut fires on keyboard input whether a hand or this
  // injected it, so the chord reaches the app without any window involvement.
  public static void Chord(string spec) {
    List<ushort> modifiers = new List<ushort>();
    ushort key = 0;

    foreach (string raw in spec.ToLowerInvariant().Split('+')) {
      string part = raw.Trim();
      if (part == "ctrl") modifiers.Add(VK_CONTROL);
      else if (part == "shift") modifiers.Add(VK_SHIFT);
      else if (part == "alt") modifiers.Add(VK_MENU);
      else if (part == "win") modifiers.Add(VK_LWIN);
      else if (part.Length > 0) key = (ushort)char.ToUpperInvariant(part[0]);
    }

    foreach (ushort modifier in modifiers) WithVirtualKey(modifier, true);
    Thread.Sleep(40);
    WithVirtualKey(key, true);
    Thread.Sleep(40);
    WithVirtualKey(key, false);
    Thread.Sleep(40);
    for (int index = modifiers.Count - 1; index >= 0; index--) WithVirtualKey(modifiers[index], false);
  }
}
'@
}

if ($CompileCheck) {
  Write-Output 'compiled'
  return
}

if ($Hotkey -ne '') {
  [YichenInput]::Chord($Hotkey)
  Start-Sleep -Milliseconds 200
  # A chord that left a modifier held would turn everything typed afterwards into a
  # shortcut; this makes that visible instead of looking like an app that ignored
  # the input.
  Write-Output "modifiers:$([System.Windows.Forms.Control]::ModifierKeys)"
}
`;

/**
 * Types a title into the quick-add field and presses Enter. The field is focused by
 * name first, so this never depends on where the caret happened to already be.
 */
async function typeTask(cdp, title, expectField = null) {
  if (expectField !== null) {
    const landed = await focusField(cdp, expectField);
    if (landed !== expectField) {
      fail(`the panel has no focusable "${expectField}" control`);
      return null;
    }
  }

  const since = Date.now();
  await typeText(cdp, title);
  await pressKey(cdp, 'Enter');
  const changed = await waitForEvent('task-changed', 8_000, since);
  if (changed === null) {
    fail(`typing "${title}" and pressing Enter produced no task`);
    return null;
  }
  return changed;
}

/**
 * Puts the keyboard on a named control and returns the name it landed on. The panel
 * names every control it wants a harness to reach, so a control that moves or gets
 * inserted above another cannot shift this the way counted Tab presses did.
 */
async function gotoField(cdp, field, taskId = null) {
  const landed = await focusField(cdp, field, taskId);
  if (landed !== field) {
    fail(`the panel has no focusable "${field}"${taskId === null ? '' : ` on ${taskId}`} control`);
  }
  return landed;
}

/** Activates the focused control and reports the write the app announced for it. */
async function pressKeyAndWait(cdp, key, timeoutMs = 8_000) {
  const since = Date.now();
  await pressKey(cdp, key);
  return waitForEvent('task-changed', timeoutMs, since);
}

/** Presses a key with a modifier held and reports the write the app announced. */
async function pressKeyWithModifier(cdp, key, modifiers, timeoutMs = 8_000) {
  const since = Date.now();
  await pressKey(cdp, key, modifiers);
  return waitForEvent('task-changed', timeoutMs, since);
}

/**
 * Drags one row's grip onto another row with synthesized mouse input.
 *
 * Chromium turns these into pointer events, so the panel's own pointer handlers run
 * — capture included — with no real mouse and no window in the foreground. The
 * coordinates come from the page's own rectangles, so nothing here has to know
 * where the window sits on the screen.
 *
 * `below` picks which half of the target row to aim for, since which edge the drop
 * lands on is exactly what decides where the row ends up.
 */
async function dragGripOntoRow(cdp, fromId, toId, below) {
  const points = await requireEval(
    cdp,
    `(() => {
       const pick = (field, id) =>
         document.querySelector('[data-field="' + field + '"][data-task-id="' + id + '"]');
       const grip = pick('task-grip', ${JSON.stringify(fromId)});
       const target = document.querySelector('li[data-task-id="' + ${JSON.stringify(toId)} + '"]');
       if (grip === null || target === null) return null;
       const grabbed = grip.getBoundingClientRect();
       // The whole row box, not the title: aiming just outside the target's vertical
       // middle is what decides which side of it the row lands on.
       const onto = target.getBoundingClientRect();
       return {
         x: grabbed.left + grabbed.width / 2,
         y: grabbed.top + grabbed.height / 2,
         toY: ${below === true ? 'onto.bottom - 2' : 'onto.top + 2'},
       };
     })()`,
    'measure the rows to drag between',
  );
  if (points === null) return null;

  const since = Date.now();
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: points.x,
    y: points.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  // Two moves, so the gesture reads as a drag rather than a press that never left.
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: points.x,
    y: points.y + 8,
    button: 'left',
    buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: points.x,
    y: points.toY,
    button: 'left',
    buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: points.x,
    y: points.toY,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  return waitForEvent('task-changed', 8_000, since);
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('[smoke] this harness drives the Windows keyboard; it only runs on Windows.');
    process.exit(2);
  }

  rmSync(smokeDir, { recursive: true, force: true });
  mkdirSync(smokeDir, { recursive: true });
  writeFileSync(ps1File, PS1, 'ascii');

  // The helper is C# compiled at runtime, and PowerShell exits 0 even when that
  // compilation fails. Checked up front, so a broken harness is never reported as
  // an application that ignored its input.
  const compiled = sendHotkey(undefined, true);
  if (compiled.stderr.trim() !== '' || !compiled.stdout.includes('compiled')) {
    console.error('[smoke] the PowerShell hotkey helper did not compile; refusing to report on the app.');
    process.exit(2);
  }
  log('the hotkey helper compiled');

  if (!skipBuild) {
    log('building renderer + main bundles');
    const npmCli = process.env.npm_execpath;
    if (npmCli === undefined) {
      execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    } else {
      execFileSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, stdio: 'inherit' });
    }
  }

  const electronBinary = require('electron');
  log('launching electron');
  let child = launchApp(electronBinary, smokeDir);
  /** The panel page, once the app is up; reassigned on the restart in phase 5. */
  let cdp = null;

  try {
    // --- phase 0: boot --------------------------------------------------------
    const ready = await waitForEvent('ready', 45_000);
    if (ready === null) {
      fail('the app never reported ready');
      return;
    }
    pass('app booted with its own empty database', ready.boot ?? null);

    // The panel mounts hidden at boot and already runs its first query, so an
    // empty Inbox has to be drawn before anything is typed: that is what makes the
    // later count meaningful.
    const firstRender = await waitForEvent('tasks-rendered', 20_000, ready.at - 2_000);
    if (firstRender === null) {
      fail('the panel never reported its first list render');
    } else if (firstRender.detail?.count === 0) {
      pass('the panel queried the Inbox and drew the empty state');
    } else {
      fail(`the fresh database already had ${firstRender.detail?.count} task(s) rendered`);
    }

    cdp = await attachPanel(20_000);
    if (cdp === null) {
      fail(`the panel page never appeared on the debugger port ${CDP_PORT}`);
      return;
    }
    log(`attached to the panel page over the debugger port ${CDP_PORT}`);

    // --- phase 1: open the panel with the global shortcut ---------------------
    // Retried, because a chord sent before the window manager has settled is
    // swallowed like any other keystroke. This is the only OS input the run makes:
    // a registered hotkey never fires for input it did not see on the queue.
    let opened = null;
    for (let attempt = 1; attempt <= 3 && opened === null; attempt += 1) {
      const since = Date.now();
      sendHotkey('ctrl+shift+n');
      opened = await waitForEvent('panel-expanded', 2_000, since);
      if (opened === null) log(`the shortcut did not open the panel on attempt ${attempt} — retrying`);
    }
    if (opened === null) {
      fail('the quick-add shortcut did not open the panel');
      return;
    }
    pass('the quick-add shortcut opened the panel', opened.detail);

    // Verified from inside the page rather than from the app's own report, so the
    // "the caret is in the field" claim is about the DOM, not about a callback
    // that claimed it had been called.
    const focusedNow = await activeField(cdp);
    if (focusedNow === 'quick-add') {
      pass('opening the panel put the caret in the quick-add field');
    } else {
      fail(`the caret is on "${focusedNow}", expected the quick-add field`);
    }

    // Nothing is clicked here on purpose: an injected click does give the panel the
    // OS foreground, but the console that injected it takes that foreground straight
    // back, and the panel reads the resulting blur as a user who walked away. Keys
    // sent over the debugger protocol never need the foreground at all.

    // --- phase 2: create the first task --------------------------------------
    const created = await typeTask(cdp, FIRST_TASK);
    if (created === null) return;

    if (created.detail?.kind === 'created' && (created.detail?.ids?.length ?? 0) === 1) {
      pass('the write was announced as a created task', created.detail);
    } else {
      fail(`expected one created id, got ${JSON.stringify(created.detail)}`);
    }
    // The badge the main process recomputed from the counts — not the stub state
    // the marker is *sent* under the harness.
    if (created.detail?.badge === 1) {
      pass('the marker badge counted the new task (0 → 1)', { badge: created.detail.badge });
    } else {
      fail(`expected the badge to read 1 after one task, got ${created.detail?.badge}`);
    }

    const secondRender = await waitForEvent('tasks-rendered', 5_000, created.at);
    if (secondRender === null) {
      fail('the panel did not re-render after the write');
    } else if (
      secondRender.detail?.count === 1 &&
      (secondRender.detail?.titles ?? []).includes(FIRST_TASK)
    ) {
      pass('the panel re-fetched and drew the new row', secondRender.detail);
    } else {
      fail(`the panel drew ${JSON.stringify(secondRender.detail)}, expected "${FIRST_TASK}"`);
    }

    let rows = readTasks();
    if (rows.length === 1 && rows[0].title === FIRST_TASK) {
      pass('the task is in SQLite, exactly as typed', rows[0]);
    } else {
      fail(`the database holds ${JSON.stringify(rows)}, expected one "${FIRST_TASK}"`);
    }
    if (
      rows.length === 1 &&
      rows[0].status === 'todo' &&
      rows[0].listId === null &&
      rows[0].parentId === null
    ) {
      pass('the row defaults to an open, unfiled, top-level Inbox task');
    } else {
      fail(`the row defaults are wrong: ${JSON.stringify(rows[0] ?? null)}`);
    }

    // --- phase 3: a second task, with the caret left where it was -------------
    // The caret stays in the field after Enter, so typing must keep working without
    // anything re-focusing it — that is the difference between quick add and a
    // one-shot form.
    const stillThere = await activeField(cdp);
    if (stillThere === 'quick-add') {
      pass('the caret stayed in the quick-add field after Enter');
    } else {
      fail(`the caret moved to "${stillThere}" after storing a task`);
    }

    const second = await typeTask(cdp, SECOND_TASK);
    if (second === null) return;

    if (second.detail?.badge === 2) {
      pass('the badge counted the second task too', { badge: 2 });
    } else {
      fail(`expected the badge to read 2 after two tasks, got ${second.detail?.badge}`);
    }

    const thirdRender = await waitForEvent('tasks-rendered', 5_000, second.at);
    if (thirdRender?.detail?.count === 2) {
      pass('both tasks are drawn', thirdRender.detail);
    } else {
      fail(`expected two rows to be drawn, got ${JSON.stringify(thirdRender?.detail ?? null)}`);
    }

    rows = readTasks();
    if (rows.length === 2 && rows[0].title === FIRST_TASK && rows[1].title === SECOND_TASK) {
      pass('both tasks are stored in the order they were typed');
    } else {
      fail(`the database holds ${JSON.stringify(rows)}, expected both titles in order`);
    }

    // --- phase 4: the detail view edits the first task (slice S4) -------------
    const firstId = rows[0].id;
    const onRow = await gotoField(cdp, 'task-title', firstId);
    if (onRow === 'task-title') pass('the first row took the focus by name');

    const detailOpened = await (async () => {
      const since = Date.now();
      await pressKey(cdp, 'Enter');
      return waitForEvent('detail-opened', 5_000, since);
    })();
    if (
      detailOpened?.detail?.title === FIRST_TASK &&
      detailOpened?.detail?.taskId === firstId &&
      detailOpened?.detail?.focused === true
    ) {
      pass('Enter on the row opened its detail with the caret in the title', detailOpened.detail);
    } else {
      fail(`the detail did not open on the expected row: ${JSON.stringify(detailOpened?.detail ?? null)}`);
    }

    await gotoField(cdp, 'detail-due-tomorrow');
    const dueChanged = await pressKeyAndWait(cdp, 'Enter');
    if (dueChanged?.detail?.kind === 'updated') {
      pass('pressing "Tomorrow" saved the due date', dueChanged.detail);
    } else {
      fail(`the due date edit produced no update: ${JSON.stringify(dueChanged?.detail ?? null)}`);
    }

    rows = readTasks();
    if (rows[0].dueAt === dayStart(1) && rows[0].dueHasTime === 0) {
      pass('the due date is tomorrow at local midnight, date only', {
        dueAt: rows[0].dueAt,
        expected: dayStart(1),
      });
    } else {
      fail(`the due date landed on ${rows[0].dueAt}, expected ${dayStart(1)} with no clock time`);
    }

    await gotoField(cdp, 'detail-priority-high');
    const priorityChanged = await pressKeyAndWait(cdp, 'Enter');
    if (priorityChanged?.detail?.kind === 'updated') {
      pass('pressing "High priority" saved the priority', priorityChanged.detail);
    } else {
      fail(`the priority edit produced no update: ${JSON.stringify(priorityChanged?.detail ?? null)}`);
    }

    rows = readTasks();
    if (rows[0].priority === 3) {
      pass('the priority is stored as High (3)', { priority: rows[0].priority });
    } else {
      fail(`the priority is ${rows[0].priority}, expected 3`);
    }

    // --- phase 4b: Escape goes back to the list ------------------------------
    const since = Date.now();
    await pressKey(cdp, 'Escape');
    const detailClosed = await waitForEvent('detail-closed', 5_000, since);
    const backToList = await waitForEvent('tasks-rendered', 5_000, since);
    if (detailClosed !== null && detailClosed.detail?.taskId === firstId) {
      pass('Escape closed the detail');
    } else {
      fail(`Escape did not close the detail: ${JSON.stringify(detailClosed?.detail ?? null)}`);
    }
    // The chips are drawn by the same pure function the row uses, so reading them
    // here is the list's own report of what the two edits produced.
    if (backToList?.detail?.rows?.[0]?.priority === 3 && backToList.detail.rows[0].due !== null) {
      pass('the list drew the edited priority chip and a due chip', backToList.detail.rows[0]);
    } else {
      fail(`the list drew ${JSON.stringify(backToList?.detail?.rows?.[0] ?? null)}, expected priority 3 and a due chip`);
    }

    // --- phase 4c: the row moves inside its group (slice S5) ------------------
    // Alt+↑/↓ is the reorder a keyboard can reach, and the one a harness can take
    // without a pointer at all.
    await gotoField(cdp, 'task-title', firstId);
    const movedDown = await pressKeyWithModifier(cdp, 'ArrowDown', ALT);
    if (movedDown?.detail?.kind === 'reordered') {
      pass('Alt+↓ moved the focused row down', movedDown.detail);
    } else {
      fail(`Alt+↓ produced no reorder: ${JSON.stringify(movedDown?.detail ?? null)}`);
    }

    const movedRender = await waitForEvent('tasks-rendered', 5_000, movedDown?.at ?? 0);
    if (
      movedRender?.detail?.titles?.[0] === SECOND_TASK &&
      movedRender?.detail?.titles?.[1] === FIRST_TASK
    ) {
      pass('the list drew the swapped order', movedRender.detail.titles);
    } else {
      fail(`the list drew ${JSON.stringify(movedRender?.detail?.titles ?? null)}, expected the two rows swapped`);
    }

    // React re-attaches a row when the order changes, and an element that was
    // detached loses the focus with it: without the panel putting the caret back,
    // the second Alt+↑ would go nowhere at all.
    const focusAfterMove = await activeField(cdp);
    if (focusAfterMove === 'task-title') {
      pass('the moved row still holds the focus, so the shortcut repeats');
    } else {
      fail(`the caret is on "${focusAfterMove}" after a move, expected the moved row's title`);
    }

    const movedUp = await pressKeyWithModifier(cdp, 'ArrowUp', ALT);
    rows = readTasks();
    if (movedUp?.detail?.kind === 'reordered' && rows[0].title === FIRST_TASK) {
      pass('Alt+↑ put the row back where it started', { order: rows.map((row) => row.title) });
    } else {
      fail(`Alt+↑ did not restore the order: ${JSON.stringify(rows.map((row) => row.title))}`);
    }

    // And the same move by hand: grip → the row below it.
    const dragged = await dragGripOntoRow(cdp, firstId, rows[1].id, true);
    rows = readTasks();
    if (dragged?.detail?.kind === 'reordered' && rows[1].title === FIRST_TASK) {
      pass('dragging the grip over the row below moved it there', {
        order: rows.map((row) => row.title),
      });
    } else {
      fail(`the drag produced ${JSON.stringify(dragged?.detail ?? null)} and the order ${JSON.stringify(rows.map((row) => row.title))}`);
    }

    // --- phase 4d: a checklist and a repeat (slice S6) ------------------------
    // The same detail, opened again: whatever the drag did to the list, the row is
    // still reachable by name, and the checklist and the repeat live below the
    // fields the previous slice covered.
    await gotoField(cdp, 'task-title', firstId);
    const reopened = await (async () => {
      const since = Date.now();
      await pressKey(cdp, 'Enter');
      return waitForEvent('detail-opened', 5_000, since);
    })();
    if (reopened?.detail?.taskId === firstId) {
      pass('the row opened its detail again after the drag');
    } else {
      fail(`the detail did not reopen on ${firstId}: ${JSON.stringify(reopened?.detail ?? null)}`);
    }

    await gotoField(cdp, 'detail-subtask-input');
    const subtaskAdded = await (async () => {
      const since = Date.now();
      await typeText(cdp, SUBTASK);
      await pressKey(cdp, 'Enter');
      return waitForEvent('task-changed', 8_000, since);
    })();
    rows = readTasks('all');
    const subtaskRow = rows.find((row) => row.title === SUBTASK);
    if (subtaskAdded?.detail?.kind === 'created' && subtaskRow?.parentId === firstId) {
      pass('a subtask typed into the detail was stored under the open task', subtaskRow);
    } else {
      fail(`the subtask produced ${JSON.stringify(subtaskAdded?.detail ?? null)} and the row ${JSON.stringify(subtaskRow ?? null)}`);
    }
    // The field is left ready for the next one, like quick-add — which is the
    // difference between a checklist and a form.
    const caretAfterSubtask = await activeField(cdp);
    if (caretAfterSubtask === 'detail-subtask-input') {
      pass('the caret stayed in the subtask field after Enter');
    } else {
      fail(`the caret moved to "${caretAfterSubtask}" after adding a subtask`);
    }

    await gotoField(cdp, 'detail-repeat-daily');
    const repeatSet = await pressKeyAndWait(cdp, 'Enter');
    rows = readTasks();
    const repeated = rows.find((row) => row.id === firstId);
    if (repeatSet?.detail?.kind === 'updated' && repeated?.repeatRule === 'FREQ=DAILY') {
      pass('pressing "Daily" stored an RRULE on the task', { rule: repeated.repeatRule });
    } else {
      fail(`the repeat edit produced ${JSON.stringify(repeatSet?.detail ?? null)} and the rule ${JSON.stringify(repeated?.repeatRule ?? null)}`);
    }

    // Escape, then read the tally off the list itself: the `0/1` chip is drawn by the
    // same pure function the row uses, so this is the list's own report (M02 S6).
    const subtaskSince = Date.now();
    await pressKey(cdp, 'Escape');
    await waitForEvent('detail-closed', 5_000, subtaskSince);
    const tallyChip = await evaluate(
      cdp,
      `(() => {
         const chip = document.querySelector('[data-field="row-progress"][data-task-id="${firstId}"]');
         return chip === null ? null : chip.textContent;
       })()`,
    );
    if (tallyChip === '0/1') {
      pass('the parent row drew its checklist tally', { chip: tallyChip });
    } else {
      fail(`the parent row's tally chip reads ${JSON.stringify(tallyChip)}, expected "0/1"`);
    }

    // --- phase 5: the edits are still there after a restart -------------------
    // A second launch of the same build against the same database file: what the
    // panel shows now came off the disk rather than out of the first run's memory.
    // The rows are read once more before the app is stopped, so a database that
    // went missing would be reported here rather than as an app that lost its data.
    const beforeRestart = readTasks();
    if (
      beforeRestart.length === 2 &&
      beforeRestart[0].title === SECOND_TASK &&
      beforeRestart[1].priority === 3
    ) {
      pass('the moved order and the edits are on disk before the restart', beforeRestart);
    } else {
      fail(`the database reads ${JSON.stringify(beforeRestart)} just before the restart`);
    }

    log('restarting electron against the same database');
    cdp.close();
    stopApp(child);
    // Taskkill reports when the process is gone, but the database file is released
    // a moment later; the relaunch opens it straight away, so give it that moment.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const restartDir = join(smokeDir, 'restart');
    mkdirSync(restartDir, { recursive: true });
    statusFile = join(restartDir, 'status.json');
    child = launchApp(electronBinary, restartDir);

    const restarted = await waitForEvent('ready', 45_000);
    if (restarted === null) {
      fail('the app never reported ready after the restart');
      return;
    }
    const restartRender = await waitForEvent('tasks-rendered', 20_000, restarted.at);
    if (restartRender?.detail?.count === 2) {
      pass('the restarted app read both tasks back', { count: restartRender.detail.count });
    } else {
      fail(`the restarted app drew ${JSON.stringify(restartRender?.detail ?? null)}, expected two rows`);
    }
    if (
      restartRender?.detail?.rows?.[0]?.title === SECOND_TASK &&
      restartRender?.detail?.rows?.[1]?.priority === 3 &&
      restartRender?.detail?.rows?.[1]?.due !== null
    ) {
      pass('the restarted app read the moved order and the edits back', restartRender.detail.rows);
    } else {
      fail(`after the restart the list reads ${JSON.stringify(restartRender?.detail?.rows ?? null)}`);
    }

    // --- phase 6: ticking a repeating task mints its next occurrence (S6) -----
    // The one path no unit test can take: the tick goes in through the real detail
    // view, the rule comes off the disk rather than out of this run's memory, and the
    // row that appears is the one the list draws. The task repeats daily from
    // tomorrow, so the occurrence a tick today mints is the day after that.
    cdp = await attachPanel(20_000);
    if (cdp === null) {
      fail(`the restarted app never appeared on the debugger port ${CDP_PORT}`);
      return;
    }

    // Expanded again with the one OS input the run makes anyway, so the window is
    // really shown and the page is not being driven while unmapped.
    let panelOpened = null;
    for (let attempt = 1; attempt <= 3 && panelOpened === null; attempt += 1) {
      const since = Date.now();
      sendHotkey('ctrl+shift+n');
      panelOpened = await waitForEvent('panel-expanded', 2_000, since);
      if (panelOpened === null) log(`the shortcut did not open the panel on attempt ${attempt} — retrying`);
    }
    if (panelOpened === null) {
      fail('the quick-add shortcut did not open the panel after the restart');
      return;
    }
    pass('the shortcut opened the panel again on the restarted app', panelOpened.detail);

    await gotoField(cdp, 'task-title', firstId);
    const detailAgain = await (async () => {
      const since = Date.now();
      await pressKey(cdp, 'Enter');
      return waitForEvent('detail-opened', 5_000, since);
    })();
    if (detailAgain?.detail?.taskId === firstId) {
      pass('the restarted app opened the repeating task again');
    } else {
      fail(`the detail did not reopen on ${firstId}: ${JSON.stringify(detailAgain?.detail ?? null)}`);
    }

    const knownIds = new Set(readTasks().map((row) => row.id));
    await gotoField(cdp, 'detail-status-done');
    const ticked = await pressKeyAndWait(cdp, 'Enter');
    if (ticked?.detail?.kind === 'updated' && (ticked.detail.ids?.length ?? 0) === 2) {
      pass('ticking the task was announced as one update naming both rows', ticked.detail);
    } else {
      fail(`the tick announced ${JSON.stringify(ticked?.detail ?? null)}, expected an update with two ids`);
    }

    const afterTick = readTasks();
    const completed = afterTick.find((row) => row.id === firstId);
    const minted = afterTick.find((row) => !knownIds.has(row.id) && row.title === FIRST_TASK);
    if (afterTick.length === 3 && completed?.status === 'done' && minted !== undefined) {
      pass('the tick marked the task done and wrote the next occurrence beside it', {
        topLevel: afterTick.map((row) => row.status),
      });
    } else {
      fail(`after the tick the top level reads ${JSON.stringify(afterTick)}`);
    }

    if (
      minted?.status === 'todo' &&
      minted.repeatRule === 'FREQ=DAILY' &&
      minted.dueAt === dayStart(2) &&
      minted.dueHasTime === 0
    ) {
      pass('the new occurrence is open, still daily, and due the day after tomorrow', {
        dueAt: minted.dueAt,
        expected: dayStart(2),
      });
    } else {
      fail(
        `the new occurrence reads ${JSON.stringify(minted ?? null)}, expected an open FREQ=DAILY task due ${dayStart(2)} at local midnight`,
      );
    }

    const mintedChildren = readTasks('subtasks').filter((row) => row.parentId === minted?.id);
    if (minted !== undefined && mintedChildren.length === 0) {
      pass('the new occurrence starts with a fresh checklist');
    } else {
      fail(`the new occurrence carries ${mintedChildren.length} subtask(s)`);
    }

    // The list is read after the detail closes, because that is when the list is the
    // thing on screen and the thing that reports what it drew (M02 D10: the ticked row
    // leaves the Inbox filter and the new occurrence takes its place).
    const listSince = Date.now();
    await pressKey(cdp, 'Escape');
    await waitForEvent('detail-closed', 5_000, listSince);
    const afterTickRender = await waitForEvent('tasks-rendered', 5_000, listSince);
    if (
      afterTickRender?.detail?.count === 2 &&
      afterTickRender?.detail?.titles?.[0] === SECOND_TASK &&
      afterTickRender?.detail?.titles?.[1] === FIRST_TASK
    ) {
      pass('the list drew the new occurrence where the completed row had been', afterTickRender.detail.titles);
    } else {
      fail(
        `the list drew ${JSON.stringify(afterTickRender?.detail ?? null)}, expected the new occurrence in the completed row's place`,
      );
    }
    // The tally is the one thing that tells the swapped-in row from the one it
    // replaced: the completed row carried a checklist, the new one carries none.
    if (afterTickRender?.detail?.rows?.[1]?.progress === null) {
      pass('the row in its place is the new occurrence — no checklist tally');
    } else {
      fail(
        `the row in the completed task's place reports a tally of ${JSON.stringify(afterTickRender?.detail?.rows?.[1]?.progress ?? null)}`,
      );
    }
  } finally {
    if (cdp !== null) cdp.close();
    await new Promise((resolve) => setTimeout(resolve, 400));
    stopApp(child);
  }
}

await main();

const failures = results.filter((entry) => !entry.ok);
writeFileSync(join(smokeDir, 'report.json'), JSON.stringify({ results }, null, 2), 'utf8');
console.log(`\n[smoke] ${results.length - failures.length}/${results.length} checks passed`);
console.log(`[smoke] raw evidence: ${statusFile}`);
if (failures.length > 0) {
  console.error('[smoke] failed checks:');
  for (const failure of failures) console.error(`  - ${failure.step}`);
  process.exit(1);
}
