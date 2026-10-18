import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Grouped local logging: every line is tagged with a scope so that one boot
 * sequence reads as named groups (bootstrap / db / windows / ipc / updater).
 * Logs stay on disk only — the app ships no telemetry (docs/ARCHITECTURE.md §10).
 */
let logFile: string | null = null;

export function initLogFile(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true });
    logFile = join(directory, `main-${new Date().toISOString().slice(0, 10)}.log`);
  } catch {
    logFile = null;
  }
}

export function logFilePath(): string | null {
  return logFile;
}

export function createLogger(scope: string): (...parts: unknown[]) => void {
  return (...parts: unknown[]) => {
    const line = `${new Date().toISOString()} [${scope}] ${parts.map(stringify).join(' ')}`;
    console.log(line);
    if (logFile !== null) {
      try {
        appendFileSync(logFile, `${line}\n`, 'utf8');
      } catch {
        // Logging must never take the app down.
        logFile = null;
      }
    }
  };
}

function stringify(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}
