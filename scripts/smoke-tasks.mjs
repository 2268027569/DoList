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
 *      draws in the place the completed row had occupied (slice S6),
 *  12. two rows are multi-selected and one bulk command sets them both (slice S7),
 *  13. a single `Ctrl+Z` takes that whole command back (slice S7),
 *  14. switching to 今日 in the sidebar filters the same list rather than copying it,
 *      and a task added there is stored due today (slice S8), and
 *  15. switching back to the Inbox shows it again, next to the rows that are not due
 *      today (slice S8), and
 *  16. the panel's own opacity slider dims its surface and stores the value it settled
 *      on (M01 §9.9), and
 *  17. the six views of M03 S1 filter one list rather than copying it — the archive
 *      draws the rows the ticks took out, ticking one there takes it back, a task
 *      abandoned through the detail shows up only in 已取消, and one added in 明天 is
 *      stored due tomorrow, and
 *  18. an attachment is copied into the profile's own directory, drawn as a preview
 *      card when it is an image and as a plain row when it is not, and removing the
 *      row takes the copy with it while the file the user picked stays where it is
 *      (M03 S3).
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
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
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
/** Added while the 今日 view is showing, so it is due today by the view's own rule. */
const TODAY_TASK = 'Call the plumber';
/** Added while the 明天 view is showing, so the view's own rule dates it tomorrow. */
const TOMORROW_TASK = 'Book the flight';

/** The two files the smoke picker answers with (M03 S3): one image, one plain file. */
const PICKED_IMAGE = 'picked-note.png';
const PICKED_TEXT = 'picked-recipe.txt';

/**
 * Phase 10's slider step. Four arrow presses of five percent each take the default
 * (fully opaque) surface to 80% — a value the bounds still allow, so the check is
 * about the control working rather than about clamping.
 */
const OPACITY_ARROW_PRESSES = 4;
const OPACITY_STEP_PERCENT = 5;
const EXPECTED_OPACITY = (100 - OPACITY_ARROW_PRESSES * OPACITY_STEP_PERCENT) / 100;

/** The task phase 12 hangs a reminder on. */
const REMINDER_TASK = 'Renew the passport';

/**
 * Phase 12's clock offset, in milliseconds (M04).
 *
 * The reminder it arms is due the day after tomorrow minus thirty minutes, so the
 * offset only has to be larger than a couple of days for that moment to already be
 * behind the scheduler — which is the whole point of the offset. Three days leaves a
 * full day of margin, so the phase does not depend on what time of day the run starts:
 * the *arming* is what has to land in the future, and the day-after-tomorrow due date
 * guarantees that whatever the hour.
 */
const REMIND_CLOCK_OFFSET_MS = 72 * 60 * 60 * 1000;

/**
 * How long a reminder's fallback card takes under the harness (M04). The app's real
 * delay is three minutes; this is the same timer, armed for a length a run can wait
 * out. Two seconds of slack covers the round trip.
 */
const REMINDER_CARD_TIMEOUT_MS = 4_000;

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
  ArrowLeft: { code: 'ArrowLeft', virtualKey: 37 },
  z: { code: 'KeyZ', virtualKey: 90 },
};

/**
 * The protocol's modifier bit mask. Alt drives the reorder shortcut; Ctrl drives the
 * undo chord, which is read from `event.ctrlKey` by the panel's own key listener.
 */
const ALT = 1;
const CTRL = 2;

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

/**
 * The rows the Inbox actually draws: the same `todo`/`doing` filter the panel queries
 * with, applied by hand. `readTasks()` reads every top-level row, and a ticked task
 * that is still in the table is not one the list has a control for (M02 S7).
 */
function inboxRows() {
  return readTasks().filter((row) => row.status === 'todo' || row.status === 'doing');
}

/**
 * The reminder instances one task has, oldest first (M04).
 *
 * The instances are the scheduler's memory rather than the user's intent, so this is
 * what the phase reads to see the state it wrote: `pending` before the moment arrives,
 * `fired` after the notification went out, `dismissed` once it has been answered.
 */
function readReminders(taskId) {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    return db
      .prepare(
        'SELECT id, task_id AS taskId, fire_at AS fireAt, state, snooze_until AS snoozeUntil ' +
          'FROM reminders WHERE task_id = ? ORDER BY fire_at ASC, id ASC',
      )
      .all(taskId);
  } finally {
    db.close();
  }
}

/** The stored app settings row (JSON), read straight out of the smoke database. */
function readAppSettings() {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('app.settings');
    return row === undefined ? null : JSON.parse(row.value);
  } finally {
    db.close();
  }
}

/** Local midnight `offsetDays` from today, worked out the way the panel's presets do. */
function dayStart(offsetDays) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/** The attachment rows of one task, read straight out of the smoke database. */
function readAttachments(taskId) {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    return db
      .prepare(
        'SELECT id, task_id AS taskId, path, name, size, created_at AS createdAt ' +
          'FROM attachments WHERE task_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(taskId);
  } finally {
    db.close();
  }
}

/**
 * Polls an expression in the page until it answers truthy, and returns the answer.
 *
 * For the steps whose result is a read rather than a write: picking an attachment
 * announces nothing on `event:task-changed` — an attachment is not a task — so the
 * only honest way to know the panel has drawn the rows is to keep asking the DOM
 * until it says so.
 */
async function waitForEval(cdp, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value !== null && value !== undefined && value !== false) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

/**
 * Puts the keyboard on a control the detail names by attachment id rather than by
 * task: a task can carry several files, and the row being measured has to be the row
 * that was measured.
 */
async function gotoAttachmentField(cdp, field, attachmentId) {
  const landed = await evaluate(
    cdp,
    `(() => {
       const wanted = ${JSON.stringify(field)};
       const id = ${JSON.stringify(attachmentId)};
       const node = [...document.querySelectorAll('[data-field="' + wanted + '"]')]
         .find((each) => each.dataset.attachmentId === id);
       if (node === undefined) return null;
       node.focus();
       return node === document.activeElement ? node.dataset.field : null;
     })()`,
  );
  if (landed !== field) {
    fail(`the panel has no focusable "${field}" on attachment ${attachmentId}`);
  }
  return landed;
}

/**
 * What the panel itself says about one named control: whether it is on screen, and the
 * `data-` attributes it carries (M04).
 *
 * The reminder card is asserted through the DOM and not only through the event that
 * announced it: an event proves the main process spoke, and what the phase cares about
 * is that something was drawn for the user to read.
 */
async function readField(cdp, field) {
  return evaluate(
    cdp,
    `(() => {
       const node = document.querySelector('[data-field="${field}"]');
       if (node === null) return null;
       return {
         field: node.dataset.field ?? null,
         taskId: node.dataset.taskId ?? null,
         reminderId: node.dataset.reminderId ?? null,
         text: node.textContent,
       };
     })()`,
  );
}

/**
 * Sets a date control the way a picker would, without a picker (M04).
 *
 * The value goes in through the input's own prototype setter — React tracks the value
 * it last rendered, and assigning straight to `node.value` would be seen as no change —
 * and the blur that follows is what the detail commits on. Neither half can be skipped:
 * the setter alone leaves the edit unsaved, and the blur alone has nothing new to save.
 */
async function setDateField(cdp, field, isoDate) {
  const applied = await requireEval(
    cdp,
    `(() => {
       const node = document.querySelector('[data-field="${field}"]');
       if (node === null) return null;
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(node, ${JSON.stringify(isoDate)});
       node.dispatchEvent(new Event('input', { bubbles: true }));
       return node.value;
     })()`,
    `set the ${field} control to ${isoDate}`,
  );
  if (applied === null) return null;
  // The commit the detail does on blur only happens if there *was* a blur, so the
  // control is focused first — and the gap between the two calls lets React flush the
  // state the commit reads back.
  await new Promise((resolve) => setTimeout(resolve, 60));
  return evaluate(
    cdp,
    `(() => {
       const node = document.querySelector('[data-field="${field}"]');
       if (node === null) return null;
       node.focus();
       node.blur();
       return node.value;
     })()`,
  );
}

/**
 * A real, decodable PNG, small enough to build here rather than commit as a fixture.
 *
 * The preview comes out of the platform's own decoder, so the harness cannot hand it
 * a file that merely *looks* like an image by its name: the bytes have to be a PNG
 * for a thumbnail to come back at all. Five chunks and a CRC each is the whole format.
 */
function pngBytes(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlacing

  // One filter byte plus three colour bytes per pixel, row by row: a gradient, so the
  // file is unmistakably a picture rather than a decoder's idea of an empty one.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let at = 0;
  for (let y = 0; y < size; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < size; x += 1) {
      raw[at] = Math.round((x / (size - 1)) * 255);
      raw[at + 1] = Math.round((y / (size - 1)) * 255);
      raw[at + 2] = 128;
      at += 3;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Length, type, payload, CRC — the chunk every PNG is made of. */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

/** The PNG CRC-32 (polynomial 0xedb88320, reflected, seeded and finished with all ones). */
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
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
      /**
       * The reminder harness runs the scheduler's clock `REMIND_CLOCK_OFFSET_MS` ahead
       * of the wall clock (M04). A reminder is armed *before* its deadline, so a run
       * that wanted to watch one arrive would have to sit and wait; moving the clock
       * forward keeps the arithmetic intact — the delay is still `fire_at - now` — while
       * making the moment already be here.
       */
      YICHEN_SMOKE_REMIND_OFFSET_MS: String(REMIND_CLOCK_OFFSET_MS),
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

  // What the OS picker would have answered (M03 S3), set before the app is launched
  // because the main process reads its environment once, at startup. One image and one
  // plain file: the panel draws the one as a preview card and the other as a file row,
  // and the run has to prove both — and that only the image was asked for a preview.
  const pickedImage = join(smokeDir, PICKED_IMAGE);
  const pickedText = join(smokeDir, PICKED_TEXT);
  writeFileSync(pickedImage, pngBytes(32));
  writeFileSync(pickedText, 'two eggs, one onion\n');
  process.env.YICHEN_SMOKE_ATTACH = [pickedImage, pickedText].join(delimiter);

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

    // --- phase 4e: an attachment is copied in, previewed, and taken away (M03 S3) -
    // The picker itself cannot be clicked from a script, so the app was told before
    // launch what the picker would return. Everything after that is what the run
    // checks: that the file was *copied* into the profile's own attachments directory
    // rather than merely pointed at, that an image comes back with a preview while a
    // plain file does not, and that removing one row takes the app's copy with it and
    // leaves the file the user picked alone.
    await gotoField(cdp, 'detail-attachment-add');
    await pressKey(cdp, 'Enter');

    const drawn = await waitForEval(
      cdp,
      `(() => {
         const opens = document.querySelectorAll('[data-field="detail-attachment-open"]').length;
         const previews = document.querySelectorAll('[data-thumbnail]').length;
         return opens === 2 ? { opens, previews } : null;
       })()`,
    );
    if (drawn?.opens === 2 && drawn.previews === 1) {
      pass('both picked files were drawn, and only the image got a preview', drawn);
    } else {
      fail(`the attachment list drew ${JSON.stringify(drawn)}, expected two rows and one preview`);
    }

    const attachmentRows = readAttachments(firstId);
    const copiedImage = attachmentRows.find((row) => row.name === PICKED_IMAGE);
    const attachmentDir = join(smokeDir, 'attachments');
    const sourceBytes = readFileSync(pickedImage);
    if (
      attachmentRows.length === 2 &&
      copiedImage !== undefined &&
      copiedImage.path.startsWith(attachmentDir) &&
      existsSync(copiedImage.path) &&
      readFileSync(copiedImage.path).equals(sourceBytes)
    ) {
      pass('the image was copied into the app profile, byte for byte', {
        path: copiedImage.path,
      });
    } else {
      fail(
        `the image row is ${JSON.stringify(copiedImage ?? null)} of ${JSON.stringify(attachmentRows.map((row) => row.path))}`,
      );
    }

    // The name is the source's, so the user recognises what they attached; the size is
    // the copy's, so the row describes the file that will actually open.
    if (copiedImage?.size === sourceBytes.length) {
      pass('the row carries the source name and the copy size', {
        name: copiedImage.name,
        size: copiedImage.size,
      });
    } else {
      fail(`the row's size is ${copiedImage?.size}, expected ${sourceBytes.length}`);
    }

    // The preview is read off the page rather than trusted from the main process: the
    // card's own image element, with a data URL on it.
    const preview = await evaluate(
      cdp,
      `(() => {
         const node = document.querySelector('[data-thumbnail="${copiedImage?.id ?? 'none'}"]');
         return node === null ? null : node.getAttribute('src').slice(0, 15);
       })()`,
    );
    if (preview === 'data:image/png;') {
      pass('the image card drew a preview, as an inline PNG', { src: preview });
    } else {
      fail(`the card's preview src is ${JSON.stringify(preview)}, expected a PNG data URL`);
    }

    // Nothing is done about the open control: pressing it would hand the copy to the
    // OS, and a photo viewer opening over the run is not a check. What is checked is
    // that the control names the copy, which is the part the panel is responsible for.
    const openedPath = await evaluate(
      cdp,
      `(() => {
         const node = document.querySelector('[data-attachment-id="${copiedImage?.id ?? 'none'}"]');
         return node === null ? null : node.dataset.path;
       })()`,
    );
    if (openedPath === copiedImage?.path) {
      pass('the open control points at the stored copy', { path: openedPath });
    } else {
      fail(`the open control points at ${JSON.stringify(openedPath)}, expected the copied path`);
    }

    await gotoAttachmentField(cdp, 'detail-attachment-remove', copiedImage?.id ?? '');
    await pressKey(cdp, 'Enter');

    const afterRemove = await waitForEval(
      cdp,
      `document.querySelectorAll('[data-field="detail-attachment-open"]').length === 1`,
    );
    const remaining = readAttachments(firstId);
    if (
      afterRemove === true &&
      remaining.length === 1 &&
      remaining[0].name === PICKED_TEXT &&
      !existsSync(copiedImage?.path ?? '') &&
      // The file the user picked is theirs: the app's copy went, the source did not.
      existsSync(pickedImage)
    ) {
      pass('removing the attachment deleted the app copy and left the picked file', {
        remaining: remaining[0].name,
      });
    } else {
      fail(
        `after removing the image: ${JSON.stringify(remaining.map((row) => row.name))}, copy still there: ${existsSync(copiedImage?.path ?? '')}`,
      );
    }

    const plainRow = await evaluate(
      cdp,
      `(() => {
         const node = document.querySelector('[data-field="detail-attachment-open"]');
         const text = node === null ? null : node.textContent.trim();
         return text === null ? null : { text, preview: node.querySelector('img') !== null };
       })()`,
    );
    if (plainRow?.text === PICKED_TEXT && plainRow.preview === false) {
      pass('the plain file is drawn as a row, with the name it was picked under', plainRow);
    } else {
      fail(`the remaining attachment drew ${JSON.stringify(plainRow)}, expected the file's name and no preview`);
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

    // --- phase 7: a multi-selection takes one bulk command (slice S7) ---------
    // The rows to act on are read off the database rather than remembered from
    // earlier: the completed instance left the Inbox and the new occurrence took its
    // place, so the ids this run holds from phase 2 are no longer both on screen.
    const selectedRows = inboxRows();
    // Read before the command, because the undo has to put these exact values back —
    // not a default. The ticked task repeats, so its new occurrence inherited the
    // priority the completed one carried rather than starting from nothing.
    const prioritiesBefore = selectedRows.map((row) => row.priority);
    for (const row of selectedRows) {
      await gotoField(cdp, 'row-select', row.id);
      await pressKey(cdp, 'Enter');
    }

    const barCount = await evaluate(
      cdp,
      `(() => {
         const bar = document.querySelector('[data-field="bulk-bar"]');
         return bar === null ? null : bar.dataset.count;
       })()`,
    );
    if (barCount === '2') {
      pass('selecting two rows raised the bulk bar over the list', { count: barCount });
    } else {
      fail(`the bulk bar reports ${JSON.stringify(barCount)}, expected "2"`);
    }

    // "High priority" is the command with an observable result on the rows and no
    // interaction with the Inbox filter — a tick would take the rows out of the view
    // before the undo could be read off them.
    await gotoField(cdp, 'bulk-priority-high');
    const raised = await pressKeyAndWait(cdp, 'Enter');
    if (raised?.detail?.kind === 'updated' && (raised.detail.ids?.length ?? 0) === 2) {
      pass('the bulk command was announced as one update naming both rows', raised.detail);
    } else {
      fail(`the bulk command announced ${JSON.stringify(raised?.detail ?? null)}, expected one update with two ids`);
    }

    const raisedRows = inboxRows();
    if (raisedRows.length === 2 && raisedRows.every((row) => row.priority === 3)) {
      pass('both selected rows carry the priority the one command set', {
        priorities: raisedRows.map((row) => row.priority),
      });
    } else {
      fail(
        `after the bulk command the Inbox reads ${JSON.stringify(raisedRows.map((row) => row.priority))}, expected two 3s`,
      );
    }
    // One write, one selection, and the bar has nothing left to point at.
    const barGone = await evaluate(
      cdp,
      `document.querySelector('[data-field="bulk-bar"]') === null`,
    );
    if (barGone === true) {
      pass('the bulk bar went away with the selection it acted on');
    } else {
      fail('the bulk bar is still drawn after the command it ran on a selection');
    }

    // --- phase 8: one Ctrl+Z takes the whole bulk command back (slice S7) -----
    // The selection was one write, so it is one entry on the undo stack and one chord
    // has to take all of it back — not just the row the caret happens to be on.
    await gotoField(cdp, 'task-title', selectedRows[0].id);
    const undone = await pressKeyWithModifier(cdp, 'z', CTRL);
    if (undone?.detail?.kind === 'undone' && (undone.detail.ids?.length ?? 0) === 2) {
      pass('Ctrl+Z was announced as one undo naming both rows', undone.detail);
    } else {
      fail(`Ctrl+Z announced ${JSON.stringify(undone?.detail ?? null)}, expected one undo with two ids`);
    }

    const restoredRows = inboxRows();
    if (
      restoredRows.length === 2 &&
      JSON.stringify(restoredRows.map((row) => row.priority)) === JSON.stringify(prioritiesBefore) &&
      prioritiesBefore.some((priority) => priority !== 3)
    ) {
      pass('the whole bulk command was taken back by a single chord', {
        before: prioritiesBefore,
        after: restoredRows.map((row) => row.priority),
      });
    } else {
      fail(
        `after Ctrl+Z the Inbox reads ${JSON.stringify(restoredRows.map((row) => row.priority))}, expected the ${JSON.stringify(prioritiesBefore)} they had before the command`,
      );
    }

    // --- phase 9: 今日 is a filter, not a second copy of the list (slice S8) ---
    // The sidebar sets the same state the app menu's 今日 item asks for over
    // `event:panel-view`, so driving the sidebar covers the view itself; the
    // right-click and the menu are the marker harness's phase 5.
    await gotoField(cdp, 'view-today');
    const todaySince = Date.now();
    await pressKey(cdp, 'Enter');
    const todayRender = await waitForEvent('tasks-rendered', 5_000, todaySince);
    if (todayRender?.detail?.view === 'today' && todayRender?.detail?.count === 0) {
      pass('今日 drew nothing — neither row is due by the end of today', todayRender.detail);
    } else {
      fail(
        `今日 drew ${JSON.stringify(todayRender?.detail ?? null)}, expected the "today" view with no rows`,
      );
    }

    // What is added while 今日 is showing is due today: the view *is* the filter, so a
    // task with no due date would be stored and then not drawn — the opposite of what
    // adding to 今日 means. The Inbox leaves the date alone, which is why this is a
    // rule of the view rather than of the field.
    await gotoField(cdp, 'quick-add');
    const beforeTodayAdd = Date.now();
    const addedToday = await typeTask(cdp, TODAY_TASK);
    const todayRow = readTasks().find((row) => row.title === TODAY_TASK);
    if (todayRow?.dueAt === dayStart(0) && todayRow?.dueHasTime === 0) {
      pass('a task added in 今日 is due today, as a day rather than an instant', {
        dueAt: todayRow.dueAt,
        expected: dayStart(0),
      });
    } else {
      fail(
        `the task added in 今日 reads dueAt ${JSON.stringify(todayRow?.dueAt ?? null)}, expected ` +
          `${dayStart(0)} with dueHasTime 0`,
      );
    }
    if (addedToday === null) return;

    const todayAfterAdd = await waitForEvent('tasks-rendered', 5_000, beforeTodayAdd);
    if (
      todayAfterAdd?.detail?.view === 'today' &&
      todayAfterAdd?.detail?.count === 1 &&
      todayAfterAdd?.detail?.titles?.[0] === TODAY_TASK
    ) {
      pass('今日 drew the row that fell inside it', todayAfterAdd.detail.titles);
    } else {
      fail(
        `今日 drew ${JSON.stringify(todayAfterAdd?.detail ?? null)}, expected the one due-today row`,
      );
    }

    // And back in the Inbox the same row is still there, alongside the two that are
    // not due today: the views differ by their filter alone, and no row was copied.
    await gotoField(cdp, 'view-inbox');
    const inboxSince = Date.now();
    await pressKey(cdp, 'Enter');
    const inboxRender = await waitForEvent('tasks-rendered', 5_000, inboxSince);
    if (
      inboxRender?.detail?.view === 'inbox' &&
      inboxRender?.detail?.count === 3 &&
      inboxRender?.detail?.titles?.includes(TODAY_TASK)
    ) {
      pass('the Inbox holds the same row plus the two that are not due today', inboxRender.detail.titles);
    } else {
      fail(
        `the Inbox drew ${JSON.stringify(inboxRender?.detail ?? null)}, expected three rows ` +
          `including ${TODAY_TASK}`,
      );
    }

    // --- phase 10: the panel's own surface can be made see-through (M01 §9.9) ---
    // One slider in the panel header, because the control's whole point is that its
    // effect is visible while it is used. It is driven by arrow keys so the value goes
    // through the same React state a mouse drag would: a focused range fires the same
    // change event either way.
    await gotoField(cdp, 'panel-settings');
    await pressKey(cdp, 'Enter');
    const popover = await evaluate(
      cdp,
      `document.querySelector('[data-field="panel-appearance"]') !== null`,
    );
    if (popover === true) {
      pass('the header control opened the panel appearance popover');
    } else {
      fail('the panel appearance popover did not open');
    }

    const cardBefore = await evaluate(
      cdp,
      `getComputedStyle(document.querySelector('.panel-card')).backgroundColor`,
    );
    const onSlider = await gotoField(cdp, 'panel-opacity');
    if (onSlider !== null) {
      for (let index = 0; index < OPACITY_ARROW_PRESSES; index += 1) {
        await pressKey(cdp, 'ArrowLeft');
      }
      const applied = await evaluate(
        cdp,
        `(() => {
           const slider = document.querySelector('[data-field="panel-opacity"]');
           const root = document.documentElement;
           return {
             slider: Number(slider.value) / 100,
             applied: Number(root.style.getPropertyValue('--panel-opacity')),
             card: getComputedStyle(document.querySelector('.panel-card')).backgroundColor,
           };
         })()`,
      );
      if (applied?.slider === EXPECTED_OPACITY && applied?.applied === EXPECTED_OPACITY) {
        pass(`the slider moved the surface to ${EXPECTED_OPACITY * 100}%`, applied);
      } else {
        fail(
          `the slider reported ${JSON.stringify(applied ?? null)}, expected ${EXPECTED_OPACITY} ` +
            'on both the control and --panel-opacity',
        );
      }
      if (applied !== null && cardBefore !== null && applied.card !== cardBefore) {
        pass('the panel surface itself changed, not just the variable it is mixed from', {
          before: cardBefore,
          after: applied.card,
        });
      } else {
        fail(`the panel surface is still ${JSON.stringify(cardBefore)} after the slider moved`);
      }
    }

    // The write waits for the slider to settle, so this reads the row once the debounce
    // in use-panel-opacity.ts has fired. It is a settings write and not a task one:
    // nothing about the list changed, so there is no `task-changed` to wait for either.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const stored = readAppSettings();
    if (stored?.panelOpacity === EXPECTED_OPACITY) {
      pass('the opacity the slider settled on is what the settings row holds', {
        panelOpacity: stored.panelOpacity,
      });
    } else {
      fail(
        `the settings row holds panelOpacity ${JSON.stringify(stored?.panelOpacity ?? null)}, ` +
          `expected ${EXPECTED_OPACITY}`,
      );
    }

    // --- phase 11: six views of one list (M03 S1) ----------------------------
    // Every view is the Inbox filter with a different status or a different window over
    // `due_at` (M03 D3), so each check works out what the view *should* hold by
    // applying that filter to the database by hand, and compares it with what the panel
    // reported drawing. A filter written wrong in the query fails here rather than by
    // eye, and nothing below reads a row out of `tasks-rendered` alone.
    const chrome = () =>
      evaluate(
        cdp,
        `(() => {
           const marked = [...document.querySelectorAll('[data-field^="view-"]')]
             .filter((node) => node.getAttribute('aria-current') === 'page')
             .map((node) => node.dataset.view);
           return {
             current: marked[0] ?? null,
             toggles: document.querySelectorAll('[data-field="row-toggle"]').length,
             quickAdd: document.querySelector('[data-field="quick-add"]') !== null,
           };
         })()`,
      );
    const titlesOf = (rows) => rows.map((row) => row.title).sort();
    const rowsByStatus = (status) => readTasks().filter((row) => row.status === status);

    // A tick in the Inbox is what puts a row in 已完成, and it is made here rather than
    // read out of an earlier phase so this phase stands on its own: the row it creates
    // is the row it archives, and then the row it takes back out again. The Inbox is
    // already the view showing (phase 9 left it there), so asking for it again is a
    // no-op — `setView` returns early rather than re-reading a view already on screen.
    await gotoField(cdp, 'view-inbox');
    await pressKey(cdp, 'Enter');
    const inboxChrome = await chrome();
    const archivedRow = inboxRows()[0];
    if (inboxChrome?.current === 'inbox' && archivedRow !== undefined) {
      pass('the Inbox is the view showing, with a row to archive');
    } else {
      fail(
        `the panel marks ${JSON.stringify(inboxChrome?.current ?? null)} with no row to archive in ` +
          `${JSON.stringify(readTasks().map((row) => row.title))}`,
      );
    }
    if (archivedRow === undefined) return;

    await gotoField(cdp, 'row-toggle', archivedRow.id);
    const tickWrite = await pressKeyAndWait(cdp, 'Enter');
    const tickedRow = readTasks().find((row) => row.id === archivedRow.id);
    if (tickWrite !== null && tickedRow?.status === 'done') {
      pass(`ticking "${archivedRow.title}" in the Inbox marked it done`, { status: tickedRow.status });
    } else {
      fail(`ticking "${archivedRow.title}" left status ${JSON.stringify(tickedRow?.status ?? null)}`);
    }

    // 已完成 draws exactly those rows and nothing else: it is the same query with
    // `status: done`, newest completion first (M03 D3/D4). The sidebar also has to
    // agree about which view is showing — a highlight that lags the list is a panel
    // telling the user two different things.
    const doneRows = rowsByStatus('done');
    await gotoField(cdp, 'view-completed');
    const completedSince = Date.now();
    await pressKey(cdp, 'Enter');
    const completedRender = await waitForEvent('tasks-rendered', 5_000, completedSince);
    const completedChrome = await chrome();
    if (
      completedRender?.detail?.view === 'completed' &&
      completedRender?.detail?.count === doneRows.length &&
      JSON.stringify([...(completedRender.detail.titles ?? [])].sort()) ===
        JSON.stringify(titlesOf(doneRows)) &&
      completedChrome?.current === 'completed'
    ) {
      pass('已完成 drew exactly the rows the ticks took out of the Inbox', completedRender.detail.titles);
    } else {
      fail(
        `已完成 drew ${JSON.stringify(completedRender?.detail ?? null)} and marked ` +
          `${JSON.stringify(completedChrome?.current ?? null)}, expected ${doneRows.length} row(s) ` +
          `${JSON.stringify(titlesOf(doneRows))}`,
      );
    }
    if (completedChrome?.quickAdd === false) {
      pass('已完成 offered no quick-add: a "to do" typed there would not be a done task');
    } else {
      fail('已完成 still drew a quick-add field');
    }

    // Ticking a row inside 已完成 takes it back to `todo` (M03 D5), which is how a
    // wrong tick is undone — and the row leaves the archive it was in as it goes.
    await gotoField(cdp, 'row-toggle', archivedRow.id);
    const recoverSince = Date.now();
    await pressKey(cdp, 'Enter');
    const recoverWrite = await waitForEvent('task-changed', 8_000, recoverSince);
    const recovered = readTasks().find((row) => row.id === archivedRow.id);
    const completedAfter = await waitForEvent('tasks-rendered', 5_000, recoverSince);
    if (
      recoverWrite !== null &&
      recovered?.status === 'todo' &&
      completedAfter?.detail?.view === 'completed' &&
      completedAfter?.detail?.count === doneRows.length - 1
    ) {
      pass(`ticking "${archivedRow.title}" in 已完成 put it back to todo and out of the archive`, {
        status: recovered.status,
        count: completedAfter.detail.count,
      });
    } else {
      fail(
        `ticking the archived row left status ${JSON.stringify(recovered?.status ?? null)} with ` +
          `${JSON.stringify(completedAfter?.detail?.count ?? null)} row(s) in 已完成, expected todo and ` +
          `${doneRows.length - 1}`,
      );
    }

    // 已取消 is the other archive, and the detail's status control is how a row gets
    // there: nothing is cancelled by a tick, so the row is abandoned where its other
    // fields are edited.
    await gotoField(cdp, 'view-inbox');
    const inboxAgainSince = Date.now();
    await pressKey(cdp, 'Enter');
    await waitForEvent('tasks-rendered', 5_000, inboxAgainSince);

    const abandonRow = readTasks().find((row) => row.title === TODAY_TASK);
    if (abandonRow === undefined) {
      fail(`${TODAY_TASK} is not in the database to abandon`);
      return;
    }

    await gotoField(cdp, 'task-title', abandonRow.id);
    const openedSince = Date.now();
    await pressKey(cdp, 'Enter');
    await waitForEvent('detail-opened', 5_000, openedSince);
    await gotoField(cdp, 'detail-status-cancelled');
    await pressKeyAndWait(cdp, 'Enter');
    const abandoned = readTasks().find((row) => row.id === abandonRow.id);
    if (abandoned?.status === 'cancelled') {
      pass(`the detail's status control abandoned "${TODAY_TASK}"`, { status: abandoned.status });
    } else {
      fail(`"${TODAY_TASK}" reads ${JSON.stringify(abandoned?.status ?? null)} after being cancelled`);
    }

    const closedSince = Date.now();
    await pressKey(cdp, 'Escape');
    await waitForEvent('detail-closed', 5_000, closedSince);

    // 已取消 draws only cancelled rows, and offers neither a tick nor a quick-add: a
    // cancelled row is reopened by editing it, and there is no work in the view to add
    // to (M03 D5/D6).
    const cancelledRows = rowsByStatus('cancelled');
    await gotoField(cdp, 'view-cancelled');
    const cancelledSince = Date.now();
    await pressKey(cdp, 'Enter');
    const cancelledRender = await waitForEvent('tasks-rendered', 5_000, cancelledSince);
    const cancelledChrome = await chrome();
    if (
      cancelledRows.length > 0 &&
      cancelledRender?.detail?.view === 'cancelled' &&
      cancelledRender?.detail?.count === cancelledRows.length &&
      JSON.stringify([...(cancelledRender.detail.titles ?? [])].sort()) ===
        JSON.stringify(titlesOf(cancelledRows)) &&
      cancelledChrome?.current === 'cancelled'
    ) {
      pass('已取消 drew only the cancelled rows', cancelledRender.detail.titles);
    } else {
      fail(
        `已取消 drew ${JSON.stringify(cancelledRender?.detail ?? null)} and marked ` +
          `${JSON.stringify(cancelledChrome?.current ?? null)}, expected ${cancelledRows.length} row(s) ` +
          `${JSON.stringify(titlesOf(cancelledRows))}`,
      );
    }
    if (cancelledChrome?.toggles === 0 && cancelledChrome?.quickAdd === false) {
      pass('已取消 drew no tick and no quick-add: there is nothing in it to do');
    } else {
      fail(`已取消 drew ${JSON.stringify(cancelledChrome ?? null)}, expected no controls`);
    }

    // 明天 keeps the quick-add, because it is a day: the view's rule dates the row as
    // it stores it (M03 D6), which is what keeps the new row inside the filter that
    // just created it.
    await gotoField(cdp, 'view-tomorrow');
    const tomorrowSince = Date.now();
    await pressKey(cdp, 'Enter');
    const tomorrowRender = await waitForEvent('tasks-rendered', 5_000, tomorrowSince);
    const tomorrowChrome = await chrome();
    if (tomorrowRender?.detail?.view === 'tomorrow' && tomorrowChrome?.quickAdd === true) {
      pass('明天 kept a quick-add: a task added there has a day to belong to');
    } else {
      fail(
        `明天 drew ${JSON.stringify(tomorrowRender?.detail ?? null)} with ` +
          `quick-add ${JSON.stringify(tomorrowChrome?.quickAdd ?? null)}`,
      );
    }

    await gotoField(cdp, 'quick-add');
    const tomorrowAddSince = Date.now();
    if ((await typeTask(cdp, TOMORROW_TASK)) === null) return;
    const tomorrowRow = readTasks().find((row) => row.title === TOMORROW_TASK);
    if (tomorrowRow?.dueAt === dayStart(1) && tomorrowRow?.dueHasTime === 0) {
      pass('a task added in 明天 is due tomorrow at local midnight, date only', {
        dueAt: tomorrowRow.dueAt,
        expected: dayStart(1),
      });
    } else {
      fail(
        `the task added in 明天 reads dueAt ${JSON.stringify(tomorrowRow?.dueAt ?? null)} with ` +
          `dueHasTime ${JSON.stringify(tomorrowRow?.dueHasTime ?? null)}, expected ${dayStart(1)} and 0`,
      );
    }

    const tomorrowAfterAdd = await waitForEvent('tasks-rendered', 5_000, tomorrowAddSince);
    if (
      tomorrowAfterAdd?.detail?.view === 'tomorrow' &&
      tomorrowAfterAdd?.detail?.titles?.includes(TOMORROW_TASK)
    ) {
      pass('明天 drew the row it was given, in the view that dated it', tomorrowAfterAdd.detail.titles);
    } else {
      fail(`明天 drew ${JSON.stringify(tomorrowAfterAdd?.detail ?? null)} after the add`);
    }

    // 即将到期 is tomorrow through the seventh day with today excluded (M03 D3): a
    // closed window the day-dated rows can be compared against by hand.
    const upcomingSince = Date.now();
    await gotoField(cdp, 'view-upcoming');
    await pressKey(cdp, 'Enter');
    const upcomingRender = await waitForEvent('tasks-rendered', 5_000, upcomingSince);
    const expectedUpcoming = inboxRows().filter(
      (row) => row.dueAt !== null && row.dueAt >= dayStart(1) && row.dueAt < dayStart(8),
    );
    if (
      upcomingRender?.detail?.view === 'upcoming' &&
      JSON.stringify([...(upcomingRender.detail.titles ?? [])].sort()) ===
        JSON.stringify(titlesOf(expectedUpcoming)) &&
      (upcomingRender.detail.titles ?? []).includes(TOMORROW_TASK)
    ) {
      pass('即将到期 drew tomorrow through the seventh day, and nothing from 今天', {
        titles: upcomingRender.detail.titles,
        window: [dayStart(1), dayStart(8)],
      });
    } else {
      fail(
        `即将到期 drew ${JSON.stringify(upcomingRender?.detail ?? null)}, expected ` +
          `${JSON.stringify(titlesOf(expectedUpcoming))}`,
      );
    }

    // And the Inbox is back, quick-add and all: every one of the six views is the same
    // list read through a different filter, so none of them took a row away from it.
    const openNow = inboxRows();
    await gotoField(cdp, 'view-inbox');
    const lastSince = Date.now();
    await pressKey(cdp, 'Enter');
    const lastRender = await waitForEvent('tasks-rendered', 5_000, lastSince);
    const lastChrome = await chrome();
    if (
      lastRender?.detail?.view === 'inbox' &&
      lastRender?.detail?.count === openNow.length &&
      lastChrome?.quickAdd === true &&
      lastChrome?.current === 'inbox'
    ) {
      pass('the Inbox came back with its quick-add and every row that is still open', {
        count: lastRender.detail.count,
      });
    } else {
      fail(
        `the Inbox drew ${JSON.stringify(lastRender?.detail ?? null)} with ` +
          `${JSON.stringify(lastChrome ?? null)}, expected ${openNow.length} open row(s)`,
      );
    }

    // --- phase 12: a reminder speaks twice, and only once each (M04) -------------
    //
    // The last phase, because the harness runs the scheduler's clock three days ahead
    // (REMIND_CLOCK_OFFSET_MS): from here on, any reminder armed is already due, which
    // is what lets the run watch the delivery rather than wait out its delay. The
    // arithmetic under test is untouched by that — the scheduler still computes
    // `fire_at - now`, and the ordering below is the same one a real three-minute wait
    // produces.
    await gotoField(cdp, 'quick-add');
    const remindAddSince = Date.now();
    if ((await typeTask(cdp, REMINDER_TASK)) === null) return;
    await waitForEvent('tasks-rendered', 5_000, remindAddSince);

    const remindRow = readTasks().find((row) => row.title === REMINDER_TASK);
    if (remindRow === undefined) {
      fail(`${REMINDER_TASK} is not in the database to hang a reminder on`);
      return;
    }

    // A reminder is derived from a deadline (`fireAtFor`), so a task without one has
    // nothing to schedule — and must not be given a default moment instead. The task
    // was just created with no due date, so this is that case before the date is set.
    const beforeDue = readReminders(remindRow.id);
    if (beforeDue.length === 0) {
      pass('a task with no deadline arms no reminder: there is nothing to count back from');
    } else {
      fail(`a task with no deadline has ${beforeDue.length} reminder instance(s)`);
    }

    await gotoField(cdp, 'task-title', remindRow.id);
    const remindOpenSince = Date.now();
    await pressKey(cdp, 'Enter');
    await waitForEvent('detail-opened', 5_000, remindOpenSince);

    // The day after tomorrow, so that whatever the hour of the run the *arming* below
    // lands in the future and cannot go off on its own before the harness is watching.
    // A due date of tomorrow with a one-day lead would already be behind the wall clock
    // at some hours, and the instance would speak the moment it was written.
    const dueDay = new Date(dayStart(2));
    const isoDue =
      `${dueDay.getFullYear()}-${String(dueDay.getMonth() + 1).padStart(2, '0')}-` +
      `${String(dueDay.getDate()).padStart(2, '0')}`;
    const dueSetSince = Date.now();
    await setDateField(cdp, 'detail-due-date', isoDue);
    const dueWrite = await waitForEvent('task-changed', 8_000, dueSetSince);
    if (readTasks().find((row) => row.id === remindRow.id)?.dueAt === dayStart(2)) {
      pass(`the detail gave "${REMINDER_TASK}" a deadline the day after tomorrow`, {
        dueAt: dayStart(2),
        write: dueWrite?.detail?.kind ?? null,
      });
    } else {
      fail(`the deadline landed on ${JSON.stringify(readTasks().find((row) => row.id === remindRow.id)?.dueAt ?? null)}`);
    }

    // Still no reminder: the lead is what turns the deadline into an instance, and the
    // task has none yet.
    if (readReminders(remindRow.id).length === 0) {
      pass('a deadline without a lead still arms nothing: the lead is the other half');
    } else {
      fail('a deadline without a lead armed a reminder anyway');
    }

    // The preset chip: thirty minutes before the deadline. This is the write that arms
    // the instance, and the same click reschedules the scheduler onto it.
    await gotoField(cdp, 'detail-remind-30');
    const leadSince = Date.now();
    await pressKey(cdp, 'Enter');
    const leadWrite = await waitForEvent('task-changed', 8_000, leadSince);

    const expectedFireAt = dayStart(2) - 30 * 60_000;
    const armed = readReminders(remindRow.id);
    if (
      armed.length === 1 &&
      armed[0].fireAt === expectedFireAt &&
      readTasks().find((row) => row.id === remindRow.id)?.dueAt === dayStart(2)
    ) {
      pass(`the 30-minute chip armed one instance at 30 minutes before the deadline`, {
        fireAt: armed[0].fireAt,
        expected: expectedFireAt,
        write: leadWrite?.detail?.kind ?? null,
      });
    } else {
      fail(
        `the lead chip left ${JSON.stringify(armed)} with expected fireAt ${expectedFireAt}`,
      );
    }

    // One delivery, and the row says so: the instance is moved to `fired` *before* the
    // OS is asked to draw anything, so the record is what keeps a restart from
    // announcing it a second time.
    const notified = await waitForEvent('reminder-notified', 8_000, leadSince);
    const afterNotify = readReminders(remindRow.id);
    if (
      notified?.detail?.taskId === remindRow.id &&
      afterNotify.length === 1 &&
      afterNotify[0].state === 'fired'
    ) {
      pass('the due instance was handed to the notification layer and recorded as fired', {
        id: notified.detail.id,
        state: afterNotify[0].state,
      });
    } else {
      fail(
        `the notification produced ${JSON.stringify(notified?.detail ?? null)} with row ` +
          `${JSON.stringify(afterNotify)}`,
      );
    }

    // The fallback card, several minutes after the toast in the app and a couple of
    // seconds under the harness — the same timer either way. It is read off the DOM as
    // well as the event: the phase cares that something was drawn, not only that the
    // main process decided to draw it.
    const cardEvent = await waitForEvent('reminder-card', REMINDER_CARD_TIMEOUT_MS, leadSince);
    const cardField = await waitForEval(
      cdp,
      `(() => {
         const node = document.querySelector('[data-field="reminder-card"]');
         if (node === null) return null;
         return { taskId: node.dataset.taskId, reminderId: node.dataset.reminderId };
       })()`,
      REMINDER_CARD_TIMEOUT_MS,
    );
    if (
      cardEvent?.detail?.taskId === remindRow.id &&
      cardField?.taskId === remindRow.id &&
      cardField?.reminderId === cardEvent?.detail?.id
    ) {
      pass('an unanswered toast was followed by the in-app card, on the same instance', {
        taskId: cardField.taskId,
      });
    } else {
      fail(
        `the card event said ${JSON.stringify(cardEvent?.detail ?? null)} and the panel drew ` +
          `${JSON.stringify(cardField ?? null)}`,
      );
    }

    // Answering it is what closes the pair out. The card's own button is the path a
    // user takes, so the phase presses that rather than the panel's internals.
    const cardText = await readField(cdp, 'reminder-card');
    if (cardText?.text?.includes(REMINDER_TASK) === true) {
      pass('the card named the task it is about', { text: cardText.text });
    } else {
      fail(`the card reads ${JSON.stringify(cardText?.text ?? null)}`);
    }

    await gotoField(cdp, 'reminder-dismiss');
    const answerSince = Date.now();
    await pressKey(cdp, 'Enter');
    const answered = await waitForEvent('reminder-answered', 8_000, answerSince);
    const afterAnswer = readReminders(remindRow.id);
    const cardGone = await waitForEval(
      cdp,
      `document.querySelector('[data-field="reminder-card"]') === null ? true : null`,
      3_000,
    );
    if (
      answered?.detail?.id === cardEvent?.detail?.id &&
      answered?.detail?.by === 'card' &&
      afterAnswer.length === 1 &&
      afterAnswer[0].state === 'dismissed' &&
      cardGone === true
    ) {
      pass('answering the card dismissed the instance and took the card off screen', {
        id: answered.detail.id,
        state: afterAnswer[0].state,
      });
    } else {
      fail(
        `answering the card produced ${JSON.stringify(answered?.detail ?? null)} with row ` +
          `${JSON.stringify(afterAnswer)} and card-gone ${JSON.stringify(cardGone)}`,
      );
    }

    // The dedup, measured rather than assumed: over the whole run, exactly one card was
    // raised for that instance and exactly one answer was recorded. A second card would
    // mean the toast and the fallback both spoke; a second answer would mean the same
    // instance was put away twice.
    const events = readStatus()?.events ?? [];
    const cards = events.filter(
      (entry) => entry.type === 'reminder-card' && entry.detail?.id === cardEvent?.detail?.id,
    );
    const answers = events.filter(
      (entry) => entry.type === 'reminder-answered' && entry.detail?.id === cardEvent?.detail?.id,
    );
    if (cards.length === 1 && answers.length === 1) {
      pass('the instance was raised once and answered once: the two surfaces never both spoke', {
        cards: cards.length,
        answers: answers.length,
      });
    } else {
      fail(`the instance was raised ${cards.length} time(s) and answered ${answers.length} time(s)`);
    }

    // And nothing new was armed behind it: an answered instance is not rescheduled, so
    // its row is the only one the task has.
    if (readReminders(remindRow.id).length === 1) {
      pass('an answered reminder was not re-armed: one instance, one row');
    } else {
      fail(`the answered task has ${readReminders(remindRow.id).length} instances`);
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
