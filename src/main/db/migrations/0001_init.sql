-- 0001_init — initial schema (docs/ARCHITECTURE.md §5.2).
-- Primary keys are UUID v7 (time ordered): sync merges never collide across devices.
-- All timestamps are Unix milliseconds in UTC. Every business table carries
-- updated_at (LWW basis) and deleted_at (soft delete + sync tombstone).

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  list_id        TEXT REFERENCES lists(id) ON DELETE SET NULL,
  parent_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'todo',   -- todo | doing | done | cancelled
  priority       INTEGER NOT NULL DEFAULT 0,     -- 0 none 1 low 2 medium 3 high
  due_at         INTEGER,
  due_has_time   INTEGER NOT NULL DEFAULT 0,     -- 0 = date only, 1 = includes time
  repeat_rule    TEXT,                           -- RFC 5545 RRULE
  repeat_mode    TEXT,                           -- fixed | after_completion
  estimate_min   INTEGER,
  actual_min     INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  deleted_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_list_sort  ON tasks(list_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent     ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Reminder instances: every fire of a repeating task is its own row, so
-- "snooze", "missed" and "replayed after sleep" all have a data home (§5.3).
CREATE TABLE IF NOT EXISTS reminders (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  fire_at      INTEGER NOT NULL,
  state        TEXT NOT NULL DEFAULT 'pending',  -- pending | fired | snoozed | dismissed
  snooze_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders(state, fire_at);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  name       TEXT,
  size       INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Folder-sync change journal: append only (§5.5).
CREATE TABLE IF NOT EXISTS sync_journal (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  op         TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO meta (key, value) VALUES ('schema_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
