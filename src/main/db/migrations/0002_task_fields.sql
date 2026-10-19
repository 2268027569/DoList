-- 0002_task_fields — the reminder lead time M02 needs on top of 0001.
-- Append-only: never edit a shipped migration, add the next number
-- (src/main/db/migrations/index.ts).

-- Minutes before `due_at` to remind; NULL = no reminder. Only the user's intent
-- is stored here — the `reminders` rows every fire becomes are the M04
-- scheduler's output (§5.3), so storing them now would mean writing data that
-- scheduler would immediately have to recompute.
ALTER TABLE tasks ADD COLUMN remind_lead_min INTEGER;
