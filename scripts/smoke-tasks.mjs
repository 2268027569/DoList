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
 *   3. a title sent to the panel's window, then Enter, creates a task,
 *   4. the main process announces it (`task-changed`, with the badge it recomputed),
 *   5. the panel re-fetches and re-draws (`tasks-rendered`),
 *   6. the row is actually in SQLite — read straight from the smoke database.
 *
 * The panel is opened with the global shortcut (Ctrl/Cmd+Shift+N) rather than by
 * clicking the marker. That shortcut is what M02 adds, and it is exactly "open the
 * panel with the caret already in the field"; the marker's own click path is
 * covered by the marker harness. The run touches neither the cursor nor the
 * foreground window: a desktop somebody else is using cannot hold a scripted aim
 * still, and an injected click only lends the panel a foreground the injecting
 * console takes back — which the panel then reads as a user walking away.
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
const statusFile = join(smokeDir, 'status.json');
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
 * Real OS input through PowerShell: a keystroke chord, or text delivered to the
 * app's own window.
 *
 * The chord goes through the OS input queue, because a registered global shortcut
 * only fires for input that came from there. The text does not: it is posted to the
 * panel window instead, because a run on a machine whose IME is in a composing mode
 * would otherwise have its title composed into something else entirely, and the
 * assertion would then be about that machine's IME rather than about the app.
 */
function driveInput({ hotkey, type, targetPid, compileCheck }) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1File];
  if (hotkey !== undefined) args.push('-Hotkey', hotkey);
  if (targetPid !== undefined) args.push('-TargetPid', String(targetPid));
  if (compileCheck === true) args.push('-CompileCheck');
  if (type !== undefined) args.push('-Type', type);

  // stderr is carried through rather than dropped: PowerShell reports a failure to
  // compile the helper there while still exiting 0, and a helper that silently did
  // nothing would be read as the app ignoring the input.
  const result = spawnSync('powershell.exe', args, { encoding: 'utf8' });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  for (const line of stdout.split(/\r?\n/)) if (line.trim() !== '') log(line.trim());
  if (stderr.trim() !== '') {
    for (const line of stderr.split(/\r?\n/)) if (line.trim() !== '') log(`[ps] ${line.trim()}`);
  }
  return { stdout, stderr };
}

/** Reads the rows straight out of the smoke database (WAL, so a read is safe). */
function readTasks() {
  const Database = require('better-sqlite3');
  const db = new Database(databaseFile, { readonly: true });
  try {
    db.pragma('busy_timeout = 5000');
    return db
      .prepare(
        'SELECT title, status, list_id AS listId, parent_id AS parentId, deleted_at AS deletedAt ' +
          'FROM tasks ORDER BY sort_order ASC, created_at ASC',
      )
      .all();
  } finally {
    db.close();
  }
}

const PS1 = String.raw`
param(
  [string]$Type = '',
  [string]$Hotkey = '',
  [int]$TargetPid = 0,
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

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int left; public int top; public int right; public int bottom; }

  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);

  [DllImport("user32.dll")] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
  [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")] private static extern uint OwningProcessOf(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

  private const uint KEYBOARD = 1;
  private const uint KEYUP = 0x0002;
  // The left-hand virtual keys, not the generic ones: the generic VK_CONTROL /
  // VK_SHIFT name "either side", so a down/up pair sent with them can leave the
  // left-hand bit set in the keyboard state.
  private const ushort VK_CONTROL = 0xA2;
  private const ushort VK_SHIFT = 0xA0;
  private const ushort VK_MENU = 0xA4;
  private const ushort VK_LWIN = 0x5B;
  private const ushort VK_RETURN = 0x0D;

  private const uint WM_KEYDOWN = 0x0100;
  private const uint WM_KEYUP = 0x0101;
  private const uint WM_CHAR = 0x0102;

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

  // The app's biggest visible window is its panel; the marker beside it is far
  // smaller, and the rest are hidden.
  private static IntPtr PanelWindowOf(uint pid) {
    IntPtr target = IntPtr.Zero;
    long largest = 0;
    EnumWindows((hwnd, param) => {
      uint owner;
      OwningProcessOf(hwnd, out owner);
      if (owner != pid || !IsWindowVisible(hwnd)) return true;
      RECT rect;
      if (!GetWindowRect(hwnd, out rect)) return true;
      long area = (long)(rect.right - rect.left) * (long)(rect.bottom - rect.top);
      if (area > largest) { largest = area; target = hwnd; }
      return true;
    }, IntPtr.Zero);
    return target;
  }

  // Posted straight to the window's message queue instead of going through the OS
  // input queue: the composing state of whatever IME the machine is running never
  // touches it, and neither the cursor nor the foreground window is involved.
  public static bool PostText(uint pid, string text) {
    IntPtr target = PanelWindowOf(pid);
    if (target == IntPtr.Zero) return false;

    const string enter = "{ENTER}";
    int index = 0;
    while (index < text.Length) {
      if (index + enter.Length <= text.Length && text.Substring(index, enter.Length) == enter) {
        PostMessage(target, WM_KEYDOWN, (IntPtr)VK_RETURN, IntPtr.Zero);
        Thread.Sleep(40);
        PostMessage(target, WM_KEYUP, (IntPtr)VK_RETURN, IntPtr.Zero);
        Thread.Sleep(80);
        index += enter.Length;
        continue;
      }

      char character = text[index];
      PostMessage(target, WM_CHAR, (IntPtr)(ushort)character, IntPtr.Zero);
      Thread.Sleep(20);
      index++;
    }
    return true;
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

if ($Type -ne '' -and $TargetPid -gt 0) {
  if ([YichenInput]::PostText([uint32]$TargetPid, $Type)) {
    Write-Output 'typed:yes'
  } else {
    Write-Output 'typed:no'
  }
}
`;

/** Sends a title to the app's panel window and presses Enter. */
async function typeTask(title, pid) {
  const since = Date.now();
  driveInput({ type: `${title}{ENTER}`, targetPid: pid });
  const changed = await waitForEvent('task-changed', 6_000, since);
  if (changed === null) {
    fail(`typing "${title}" and pressing Enter produced no task — the quick-add field may not have had focus`);
    return null;
  }
  return changed;
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
  const compiled = driveInput({ compileCheck: true });
  if (compiled.stderr.trim() !== '' || !compiled.stdout.includes('compiled')) {
    console.error('[smoke] the PowerShell input helper did not compile; refusing to report on the app.');
    process.exit(2);
  }
  log('the input helper compiled');

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
  const child = spawn(electronBinary, ['.'], {
    cwd: root,
    env: {
      ...process.env,
      YICHEN_SMOKE: '1',
      YICHEN_SMOKE_DIR: smokeDir,
      YICHEN_SMOKE_DB: databaseFile,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  // The panel window belongs to this process, which is how the helper finds it to
  // post the titles to (§13: the text bypasses the OS input queue and the IME).
  const electronPid = child.pid ?? 0;

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

    // --- phase 1: open the panel with the global shortcut ---------------------
    // Retried, because a chord sent before the window manager has settled is
    // swallowed like any other keystroke.
    let opened = null;
    for (let attempt = 1; attempt <= 3 && opened === null; attempt += 1) {
      const since = Date.now();
      driveInput({ hotkey: 'ctrl+shift+n' });
      opened = await waitForEvent('panel-expanded', 2_000, since);
      if (opened === null) log(`the shortcut did not open the panel on attempt ${attempt} — retrying`);
    }
    if (opened === null) {
      fail('the quick-add shortcut did not open the panel');
      return;
    }
    pass('the quick-add shortcut opened the panel', opened.detail);

    const focus = await waitForEvent('quick-add-focused', 5_000, opened.at);
    if (focus?.detail?.active === true) {
      pass('opening the panel put the caret in the quick-add field');
    } else {
      fail(`the caret did not land in the quick-add field: ${JSON.stringify(focus?.detail ?? null)}`);
    }

    // Nothing is clicked here on purpose. An injected click does give the panel the
    // OS foreground, but the console that injected it takes that foreground straight
    // back, and the panel reads the resulting blur as a user who walked away: it
    // collapses. The text is posted directly to the panel window, so the run never
    // needs the foreground at all.

    // --- phase 2: create the first task with real keystrokes ------------------
    const created = await typeTask(FIRST_TASK, electronPid);
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

    // --- phase 3: a second task, without touching the mouse again -------------
    // The caret stays in the field after Enter, so typing must keep working —
    // that is the difference between quick add and a one-shot form.
    const second = await typeTask(SECOND_TASK, electronPid);
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
writeFileSync(join(smokeDir, 'report.json'), JSON.stringify({ results }, null, 2), 'utf8');
console.log(`\n[smoke] ${results.length - failures.length}/${results.length} checks passed`);
console.log(`[smoke] raw evidence: ${statusFile}`);
if (failures.length > 0) {
  console.error('[smoke] failed checks:');
  for (const failure of failures) console.error(`  - ${failure.step}`);
  process.exit(1);
}
