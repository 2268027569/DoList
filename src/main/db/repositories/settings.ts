import { getDatabase } from '../connection';

/** Raw KV access over the `settings` table; values are JSON encoded (§5.2). */
export function readRawSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value?: string }
    | undefined;
  return row?.value;
}

export function writeRawSetting(key: string, raw: string, updatedAt: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, raw, updatedAt);
}

export function readNumberSetting(key: string): number | undefined {
  const raw = readRawSetting(key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
