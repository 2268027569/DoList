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
 *      (slice S4), and
 *   8. a fresh launch reads those same values back off the disk.
 *
 * Only two things come from the OS: the global shortcut, which a registered hotkey
 * only ever sees when the input queue produced it, and the app's own launch. Every
 * other keystroke is delivered to the panel page over the DevTools protocol, which
 * is explained where the client is built below.
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

/** A key press delivered by the renderer itself, so no OS queue is involved. */
async function pressKey(cdp, key) {
  const virtualKey = { Enter: 13, Tab: 9, Escape: 27 }[key] ?? 0;
  const base = {
    key,
    code: key,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
  };
  // Enter carries a character so Chromium runs the same default action a typed one
  // does (activating a button or submitting through the field).
  const withText = key === 'Enter' ? { ...base, text: '\r', unmodifiedText: '\r' } : base;
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...withText });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
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

/** Reads the rows straight out of the smoke database (WAL, so a read is safe). */
function readTasks() {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    return db
      .prepare(
        'SELECT id, title, status, priority, due_at AS dueAt, due_has_time AS dueHasTime, ' +
          'list_id AS listId, parent_id AS parentId, deleted_at AS deletedAt ' +
          'FROM tasks ORDER BY sort_order ASC, created_at ASC',
      )
      .all();
  } finally {
    db.close();
  }
}

/** Local midnight tomorrow, worked out the same way the panel's own "Tomorrow" does. */
function tomorrowStart() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
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
    if (rows[0].dueAt === tomorrowStart() && rows[0].dueHasTime === 0) {
      pass('the due date is tomorrow at local midnight, date only', {
        dueAt: rows[0].dueAt,
        expected: tomorrowStart(),
      });
    } else {
      fail(`the due date landed on ${rows[0].dueAt}, expected ${tomorrowStart()} with no clock time`);
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

    // --- phase 5: the edits are still there after a restart -------------------
    // A second launch of the same build against the same database file: what the
    // panel shows now came off the disk rather than out of the first run's memory.
    // The rows are read once more before the app is stopped, so a database that
    // went missing would be reported here rather than as an app that lost its data.
    const beforeRestart = readTasks();
    if (beforeRestart.length === 2 && beforeRestart[0].priority === 3) {
      pass('the edits are on disk before the restart', beforeRestart[0]);
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
      restartRender?.detail?.rows?.[0]?.priority === 3 &&
      restartRender?.detail?.rows?.[0]?.due !== null
    ) {
      pass('the restarted app shows the edited priority and due chip', restartRender.detail.rows[0]);
    } else {
      fail(`after the restart the first row reads ${JSON.stringify(restartRender?.detail?.rows?.[0] ?? null)}`);
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
