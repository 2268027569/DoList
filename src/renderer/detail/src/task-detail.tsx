import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatMode, TaskPriority, TaskStatus, TaskWithTags } from '@shared/types/task';
import { REPEAT_MODES, TASK_PRIORITIES, TASK_STATUSES } from '@shared/types/task';
import { isImageName } from '@shared/utils/attachment';
import {
  dueToday,
  dueTomorrow,
  fromDueValues,
  toDateValue,
  toTimeValue,
  withDueTime,
} from '@shared/utils/task-dates';
import { progressText } from '@shared/utils/task-tree';
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  REMIND_LEAD_PRESETS,
  leadBucketOf,
} from '@shared/utils/reminder';

import { REPEAT_PRESETS, presetFor } from './repeat-presets';
import { useDetailStore } from './store';

/** Priority 0 reads as "none" here; the list row draws nothing for it. */
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  0: 'priority.none',
  1: 'priority.low',
  2: 'priority.medium',
  3: 'priority.high',
};

/** The name each priority switch answers to when the smoke harness asks for it. */
const PRIORITY_FIELD: Record<TaskPriority, string> = {
  0: 'none',
  1: 'low',
  2: 'medium',
  3: 'high',
};

/**
 * The dot each priority switch carries. A switch that says "Low" in words still has
 * to be found by eye in a row of five, and the colour is the same one the list's own
 * priority chip uses, so the two screens agree without either reading the other.
 * Written as whole class strings because that is what the Tailwind scanner sees.
 */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  0: 'bg-[var(--text-muted)]',
  1: 'bg-[var(--priority-low)]',
  2: 'bg-[var(--priority-medium)]',
  3: 'bg-[var(--priority-high)]',
};

/**
 * The wording a reminder preset answers to. One key per bucket rather than one per
 * preset, so 5 and 30 minutes are the same sentence with a different number in it —
 * and the number shown is never the stored one, which would read "1440" for a day.
 */
const REMIND_BUCKET_KEY = {
  minutes: 'detail.remindMinutes',
  hours: 'detail.remindHours',
  days: 'detail.remindDays',
} as const;

/**
 * A lead in the unit it is spoken in: 120 minutes is "2 hours", 1440 is "1 day". The
 * stored value stays minutes — that is what the column holds and what `fireAtFor` does
 * its arithmetic on — so this is a display concern only and never reaches the database.
 */
function displayLead(leadMin: number): number {
  if (leadMin >= MINUTES_PER_DAY) return leadMin / MINUTES_PER_DAY;
  if (leadMin >= MINUTES_PER_HOUR) return leadMin / MINUTES_PER_HOUR;
  return leadMin;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'status.todo',
  doing: 'status.doing',
  done: 'status.done',
  cancelled: 'status.cancelled',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'bg-[var(--text-muted)]',
  doing: 'bg-[var(--priority-low)]',
  done: 'bg-[var(--status-done)]',
  cancelled: 'bg-[var(--border-strong)]',
};

/** The two ways a repeat can count, named for the field and for the label key. */
const REPEAT_MODE_LABEL: Record<RepeatMode, string> = {
  fixed: 'detail.repeat.fixed',
  after_completion: 'detail.repeat.afterCompletion',
};

/**
 * Every text control shares one surface: a filled block with no visible edge until it
 * is focused. The fill is what says "you can type here" — an outline as well would be
 * two ways of saying it, and eleven outlined boxes in one column is what made the old
 * screen read as a form rather than as a task. `.detail-field` (detail.css) draws the
 * focused edge, because the global focus ring is a hard 2px box that on a field this
 * soft reads as a highlighter stroke.
 */
const INPUT =
  'detail-field rounded-lg border border-transparent bg-[var(--bg-surface-muted)] px-2.5 py-2 text-[12.5px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]';

/**
 * The task detail form (M02 D6).
 *
 * It is a window of its own, opened beside the panel rather than inside it: the panel is
 * 320–640 DIP wide, where a list beside anything readable is no longer readable — and the
 * list is where the next task is picked, so a form that displaces it turns every
 * comparison into a trip out and back. The window's chrome belongs to the entry
 * (main.tsx); this is only the form.
 *
 * The form is read top to bottom as three registers rather than as eleven equal blocks:
 * the title at reading size (it is the reason the window was opened), the note directly
 * under it, and then labelled groups — time, classification, checklist, files — with the
 * destructive action left to the very end, quiet and below a rule. The headings are what
 * say where one subject ends; the old version framed every field instead, which cost
 * every control a border and left the eye nothing to read the page by.
 *
 * Saving is immediate (M02 D9) — there is no save button and no dirty flag. Free text and
 * the two date controls commit when the field is left (or on Enter); a switch commits as
 * it is thrown. Leaving is therefore free: whatever was typed is already stored.
 *
 * Every control carries a `data-field` name. They are what the smoke harness reads to
 * find out where the keyboard went (§13): it attaches to this page over the DevTools
 * protocol and puts the keyboard on a control **by name**, rather than counting Tab
 * presses — which never worked, because Chromium only honours focus navigation while the
 * window really holds the foreground. New controls get a name too, or the harness cannot
 * ask for them.
 */
export function TaskDetail({ task }: { task: TaskWithTags }): ReactElement {
  const { t } = useTranslation('tasks');
  const save = useDetailStore((state) => state.save);
  const remove = useDetailStore((state) => state.remove);
  const subtasks = useDetailStore((state) => state.subtasks);
  const addSubtask = useDetailStore((state) => state.addSubtask);
  const removeSubtask = useDetailStore((state) => state.removeSubtask);
  const attachments = useDetailStore((state) => state.attachments);
  const thumbnails = useDetailStore((state) => state.thumbnails);
  const pickAttachments = useDetailStore((state) => state.pickAttachments);
  const removeAttachment = useDetailStore((state) => state.removeAttachment);
  const openAttachment = useDetailStore((state) => state.openAttachment);

  /**
   * Seeded from the row once rather than kept in step with every re-read: a refresh
   * landing mid-word would replace what the user is typing. The row itself is re-read
   * after each write, so what is shown as saved is current. Only the free-text fields
   * and the date controls need this — the switches below render the row directly.
   */
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [dueDate, setDueDate] = useState(task.dueAt === null ? '' : toDateValue(task.dueAt));
  const [dueTime, setDueTime] = useState(task.dueAt === null ? '' : toTimeValue(task.dueAt));
  const [hasTime, setHasTime] = useState(task.dueHasTime);
  const [remind, setRemind] = useState(
    task.remindLeadMin === null ? '' : String(task.remindLeadMin),
  );
  const [tagDraft, setTagDraft] = useState('');
  const [subtaskDraft, setSubtaskDraft] = useState('');
  /**
   * The custom-rule field is open when the task's rule is not one of the presets —
   * including when it has none, where the user has to reach for it deliberately.
   */
  const [customRepeat, setCustomRepeat] = useState(task.repeatRule ?? '');
  const [repeatOpen, setRepeatOpen] = useState(
    task.repeatRule !== null && presetFor(task.repeatRule) === null,
  );
  const subtaskField = useRef<HTMLInputElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  /**
   * Frozen at mount: the harness is told which row this view opened on, and the
   * title is edited right after, so reading it again later would report the edit.
   */
  const [opened] = useState(() => ({ id: task.id, title: task.title }));

  /**
   * Images draw as preview cards and everything else as file rows (M03 S3). Split from
   * the one list rather than asked of the main process twice: the rule is the shared
   * `isImageName`, the same one that decides which rows are worth a thumbnail.
   */
  const imageAttachments = attachments.filter((row) => isImageName(row.name ?? row.path));
  const fileAttachments = attachments.filter((row) => !isImageName(row.name ?? row.path));

  useEffect(() => {
    // The harness cannot click, so this is the one moment it needs to know the detail
    // opened on the expected row with the caret already in its title.
    void window.api.smoke.report('detail-opened', {
      taskId: opened.id,
      title: opened.title,
      focused: document.activeElement === titleField.current,
    });
  }, [opened]);

  /** A blank title is not a task; the field falls back to what the row holds. */
  const commitTitle = (): void => {
    const next = title.trim();
    if (next === '' || next === task.title) {
      setTitle(task.title);
      return;
    }
    void save({ title: next });
  };

  const commitNotes = (): void => {
    const next = notes.trim() === '' ? null : notes;
    if (next === (task.notes ?? null)) return;
    void save({ notes: next });
  };

  const commitDue = (date = dueDate, time = dueTime, includeTime = hasTime): void => {
    const next = fromDueValues(date, time, includeTime);
    if (next === task.dueAt && includeTime === task.dueHasTime) return;
    void save({ dueAt: next, dueHasTime: includeTime });
  };

  /** A preset is a day, not an instant, so it drops any clock time with it. */
  const applyPreset = (dayStart: number): void => {
    setDueDate(toDateValue(dayStart));
    setDueTime(toTimeValue(dayStart));
    setHasTime(false);
    void save({ dueAt: dayStart, dueHasTime: false });
  };

  const clearDue = (): void => {
    setDueDate('');
    setDueTime('');
    setHasTime(false);
    void save({ dueAt: null, dueHasTime: false });
  };

  const toggleHasTime = (includeTime: boolean): void => {
    setHasTime(includeTime);
    const day = fromDueValues(dueDate, dueTime, includeTime);
    // No date yet: the switch was the whole change, and it waits on the date.
    if (day === null) {
      void save({ dueHasTime: includeTime });
      return;
    }
    const at = withDueTime(day, includeTime);
    setDueTime(toTimeValue(at));
    void save({ dueAt: at, dueHasTime: includeTime });
  };

  const commitRemind = (): void => {
    const trimmed = remind.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setRemind(task.remindLeadMin === null ? '' : String(task.remindLeadMin));
      return;
    }
    if (next === task.remindLeadMin) return;
    void save({ remindLeadMin: next });
  };

  /**
   * Takes one of the preset leads, or clears it when it was already the active one.
   *
   * The number field is moved along with it: it is seeded once from the row and would
   * otherwise keep showing the lead the user just replaced, making the two controls
   * disagree about the one value they both write.
   */
  const chooseRemind = (minutes: number | null): void => {
    setRemind(minutes === null ? '' : String(minutes));
    void save({ remindLeadMin: minutes });
  };

  const addTag = (): void => {
    const name = tagDraft.trim();
    setTagDraft('');
    if (name === '' || task.tags.includes(name)) return;
    void save({ tags: [...task.tags, name] });
  };

  const removeTag = (name: string): void => {
    void save({ tags: task.tags.filter((tag) => tag !== name) });
  };

  /**
   * Throws one of the preset switches: the rule it names, or turning the repeat off
   * when it is already the active one. A single control that both sets and clears
   * keeps the row from needing a separate "none" button to say the same thing.
   */
  const choosePreset = (rule: string): void => {
    setRepeatOpen(false);
    setCustomRepeat('');
    void save({ repeatRule: task.repeatRule === rule ? null : rule });
  };

  /**
   * Commits the custom field. Empty clears the repeat; anything else is sent as-is
   * and the main process is the one that decides — an invalid rule comes back
   * rejected, which is reported in the header and leaves the text where it is, so
   * the user can fix the typo rather than lose it.
   */
  const commitCustomRepeat = (): void => {
    const rule = customRepeat.trim();
    if (rule === '' && task.repeatRule === null) return;
    void save({ repeatRule: rule === '' ? null : rule });
  };

  const addSubtaskFromDraft = (): void => {
    const title = subtaskDraft.trim();
    if (title === '') return;
    setSubtaskDraft('');
    void addSubtask(title).then((added) => {
      // Same as the quick-add field: the field is left ready for the next one.
      if (added) subtaskField.current?.focus();
    });
  };

  // Counted from what the checklist shows rather than from the row's tally: the
  // two must agree, and this is the one the user is looking at.
  const subtaskProgress = progressText({
    total: subtasks.length,
    done: subtasks.filter((item) => item.status === 'done').length,
  });

  return (
    <div className="flex flex-col">
      {/*
       * The title is the page, not a field of it: it is what the user opened this
       * screen to read, so it is drawn at reading size and only shows its editable
       * surface while it is focused. It commits like every other text control.
       */}
      <input
        ref={titleField}
        autoFocus
        type="text"
        value={title}
        aria-label={t('detail.title')}
        data-field="detail-title"
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitTitle();
        }}
        className="detail-title -mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-[20px] font-semibold leading-7 tracking-[-0.01em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />

      <div className="mt-2.5 h-px bg-[var(--border-default)]" aria-hidden="true" />

      <div className="mt-4 flex flex-col">
        <Field label={t('detail.notes')}>
          {/*
           * `field-sizing-content` grows the box with what is typed, so a long note is
           * read in full without a drag handle to find and without a scrollbar of its
           * own; the cap keeps one runaway note from burying every field under it.
           */}
          <textarea
            rows={2}
            value={notes}
            placeholder={t('detail.notesPlaceholder')}
            data-field="detail-notes"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={commitNotes}
            className={`${INPUT} w-full field-sizing-content min-h-16 max-h-48 resize-none`}
          />
        </Field>
      </div>

      <Group label={t('detail.group.time')}>
        <Field label={t('detail.due')}>
          {/*
           * The date and the clock share one line: they are one answer ("when"), and
           * stacked they read as two unrelated fields — with the clock appearing on a
           * line of its own the moment it is switched on. The switch that brings the
           * clock in sits at the far end of that same line, where the thing it governs
           * is, rather than below the pair as a third item.
           */}
          <div className="flex flex-nowrap items-center gap-2">
            <input
              type="date"
              value={dueDate}
              aria-label={t('detail.due')}
              data-field="detail-due-date"
              onChange={(event) => setDueDate(event.target.value)}
              onBlur={() => commitDue()}
              className={`${INPUT} min-w-0 flex-1`}
            />
            {hasTime && (
              <input
                type="time"
                value={dueTime}
                aria-label={t('detail.time')}
                data-field="detail-due-time"
                onChange={(event) => setDueTime(event.target.value)}
                onBlur={() => commitDue()}
                className={`${INPUT} w-[88px] shrink-0`}
              />
            )}
            <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={hasTime}
                data-field="detail-has-time"
                onChange={(event) => toggleHasTime(event.target.checked)}
                className="size-3.5 accent-[var(--accent)]"
              />
              {t('detail.hasTime')}
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Choice field="detail-due-today" onClick={() => applyPreset(dueToday())}>
              {t('detail.dueToday')}
            </Choice>
            <Choice field="detail-due-tomorrow" onClick={() => applyPreset(dueTomorrow())}>
              {t('detail.dueTomorrow')}
            </Choice>
            <Choice field="detail-due-clear" onClick={clearDue}>
              {t('detail.clear')}
            </Choice>
          </div>
        </Field>

        <Field label={t('detail.repeat.label')}>
          <div className="flex flex-wrap gap-1.5">
            {REPEAT_PRESETS.map((preset) => (
              <Choice
                key={preset.key}
                field={`detail-repeat-${preset.key}`}
                active={task.repeatRule === preset.rule}
                onClick={() => choosePreset(preset.rule)}
              >
                {t(`detail.repeat.${preset.key}`)}
              </Choice>
            ))}
            <Choice
              field="detail-repeat-custom"
              active={repeatOpen}
              dashed
              // Typos survive here: the field is left as the user typed it when the
              // write is rejected, so the correction is a fix rather than a retype.
              onClick={() => setRepeatOpen((open) => !open)}
            >
              {t('detail.repeat.custom')}
            </Choice>
          </div>

          {repeatOpen && (
            <input
              type="text"
              value={customRepeat}
              placeholder={t('detail.repeat.customPlaceholder')}
              aria-label={t('detail.repeat.custom')}
              data-field="detail-repeat-rule"
              onChange={(event) => setCustomRepeat(event.target.value)}
              onBlur={commitCustomRepeat}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitCustomRepeat();
              }}
              className={`${INPUT} mt-2 w-full font-mono text-[11px]`}
            />
          )}

          {/*
           * The mode is only meaningful once there is a rule to count, so it stays
           * out of the way until then.
           */}
          {task.repeatRule !== null && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REPEAT_MODES.map((mode) => (
                <Choice
                  key={mode}
                  field={`detail-repeat-mode-${mode}`}
                  active={(task.repeatMode ?? 'fixed') === mode}
                  onClick={() => void save({ repeatMode: mode })}
                >
                  {t(REPEAT_MODE_LABEL[mode])}
                </Choice>
              ))}
            </div>
          )}
        </Field>

        <Field label={t('detail.remind')}>
          {/*
           * The five preset leads sit above the custom field rather than replacing it
           * (M04): the chip is what the user reaches for nine times out of ten, and the
           * number stays for the tenth. A chip that is already the active one clears it,
           * which is the same gesture the repeat presets use.
           */}
          <div className="flex flex-wrap gap-1.5">
            {REMIND_LEAD_PRESETS.map((minutes) => (
              <Choice
                key={minutes}
                field={`detail-remind-${minutes}`}
                active={task.remindLeadMin === minutes}
                onClick={() => chooseRemind(task.remindLeadMin === minutes ? null : minutes)}
              >
                {t(REMIND_BUCKET_KEY[leadBucketOf(minutes)], { n: displayLead(minutes) })}
              </Choice>
            ))}
          </div>
          {/*
           * The custom lead stays a plain minutes field, with the unit spelled out: the
           * presets above cover the round values, and a number without a unit next to an
           * input that once said "（分钟）" is not something a reader should have to guess.
           */}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={remind}
              placeholder={t('detail.none')}
              aria-label={t('detail.remindUnit')}
              data-field="detail-remind"
              onChange={(event) => setRemind(event.target.value)}
              onBlur={commitRemind}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitRemind();
              }}
              className={`${INPUT} w-24 tabular-nums`}
            />
            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
              {t('detail.remindUnit')}
            </span>
          </div>
        </Field>
      </Group>

      <Group label={t('detail.group.organize')}>
        <Field label={t('detail.priority')}>
          <div className="flex flex-wrap gap-1.5">
            {TASK_PRIORITIES.map((level) => (
              <Choice
                key={level}
                field={`detail-priority-${PRIORITY_FIELD[level]}`}
                active={task.priority === level}
                dot={PRIORITY_DOT[level]}
                onClick={() => void save({ priority: level })}
              >
                {t(PRIORITY_LABEL[level])}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label={t('detail.status')}>
          <div className="flex flex-wrap gap-1.5">
            {TASK_STATUSES.map((value) => (
              <Choice
                key={value}
                field={`detail-status-${value}`}
                active={task.status === value}
                dot={STATUS_DOT[value]}
                onClick={() => void save({ status: value })}
              >
                {t(STATUS_LABEL[value])}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label={t('detail.tags')}>
          {task.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {/* Square where the switches are round: a tag is a label on this task,
                  not one of the answers the form is asking for. */}
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-md bg-[var(--bg-surface-muted)] px-2 py-1 text-[11px] leading-4 text-[var(--text-secondary)]"
                >
                  {`#${tag}`}
                  <button
                    type="button"
                    aria-label={t('detail.tags.remove', { name: tag })}
                    data-field="detail-tag-remove"
                    onClick={() => removeTag(tag)}
                    className="text-[var(--text-muted)] transition-colors hover:text-[var(--status-overdue)]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            type="text"
            value={tagDraft}
            placeholder={t('detail.tags.add')}
            data-field="detail-tag-input"
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addTag();
            }}
            className={`${INPUT} w-full`}
          />
        </Field>
      </Group>

      <Group
        label={t('detail.subtasks')}
        aside={subtaskProgress === null ? undefined : subtaskProgress}
      >
        {subtasks.length > 0 && (
          <ul className="flex flex-col">
            {subtasks.map((subtask) => {
              const done = subtask.status === 'done';
              return (
                <li
                  key={subtask.id}
                  className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--bg-surface-muted)]"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={t(done ? 'row.markUndone' : 'row.markDone')}
                    data-field="detail-subtask-toggle"
                    data-task-id={subtask.id}
                    onClick={() => void toggleSubtask(subtask.id, !done)}
                    className={`grid size-4 shrink-0 place-items-center rounded-full border transition-colors ${
                      done
                        ? 'border-[var(--status-done)] bg-[var(--status-done)] text-[var(--accent-on)]'
                        : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
                    }`}
                  >
                    {done && <CheckGlyph />}
                  </button>
                  <span
                    className={`min-w-0 flex-1 text-[12.5px] leading-5 break-words ${
                      done
                        ? 'text-[var(--text-muted)] line-through'
                        : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {subtask.title}
                  </span>
                  <button
                    type="button"
                    aria-label={t('detail.subtasks.remove', { title: subtask.title })}
                    data-field="detail-subtask-remove"
                    data-task-id={subtask.id}
                    onClick={() => void removeSubtask(subtask.id)}
                    className="shrink-0 rounded px-1 text-xs text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--status-overdue)] focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {/*
         * As a row rather than a boxed input: it is the same gesture as the list's
         * quick-add, and a filled field under a list reads as a form field belonging
         * to the last row instead of as "type the next one".
         */}
        <input
          ref={subtaskField}
          type="text"
          value={subtaskDraft}
          placeholder={`+ ${t('detail.subtasks.add')}`}
          aria-label={t('detail.subtasks.add')}
          data-field="detail-subtask-input"
          onChange={(event) => setSubtaskDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addSubtaskFromDraft();
          }}
          className="detail-field -mx-2 w-[calc(100%+1rem)] rounded-lg border border-transparent px-2 py-1.5 text-[12.5px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </Group>

      <Group label={t('detail.attachments')}>
        {/*
         * An image gets a card wide enough to recognise what it is, because that is
         * the whole of what a preview is for; the row keeps its name for anything
         * else, where a thumbnail would say nothing the name does not. Both open the
         * same way — a click, and the OS shows the copy (M03 S3).
         */}
        {imageAttachments.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
            {imageAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--bg-surface-muted)]"
              >
                <button
                  type="button"
                  data-field="detail-attachment-open"
                  data-attachment-id={attachment.id}
                  data-path={attachment.path}
                  title={attachment.path}
                  onClick={() => void openAttachment(attachment.id)}
                  className="grid h-full w-full place-items-center"
                >
                  {thumbnails[attachment.id] === undefined ? (
                    // No preview — the platform had none for this file. The name is
                    // still the control's name, so a screen reader reads what the
                    // filename would have said.
                    <span className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
                      <ImageGlyph />
                      <span className="sr-only">{attachment.name ?? attachment.path}</span>
                    </span>
                  ) : (
                    <img
                      src={thumbnails[attachment.id]}
                      alt={attachment.name ?? ''}
                      data-thumbnail={attachment.id}
                      className="h-full w-full object-cover"
                    />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t('detail.attachments.remove', {
                    name: attachment.name ?? attachment.path,
                  })}
                  data-field="detail-attachment-remove"
                  data-attachment-id={attachment.id}
                  // The row and the copy go; the file the user picked does not. The
                  // service refuses to unlink anything outside the app's own
                  // attachments directory (M03 S3).
                  onClick={() => void removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--bg-surface)] text-[13px] leading-none text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:text-[var(--status-overdue)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {fileAttachments.length > 0 && (
          <ul className="flex flex-col">
            {fileAttachments.map((attachment) => (
              <li
                key={attachment.id}
                className="group -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--bg-surface-muted)]"
              >
                {/*
                 * The extension, not a file icon: it is the one thing about a file
                 * this narrow that says what opening it will bring up, and it needs
                 * no artwork to say it.
                 */}
                <span className="w-9 shrink-0 truncate rounded bg-[var(--bg-surface-muted)] py-0.5 text-center text-[10px] font-semibold tracking-wide uppercase text-[var(--text-muted)]">
                  {extensionOf(attachment.name ?? attachment.path)}
                </span>
                {/*
                 * The whole name is a button, because opening the file is the one
                 * thing an attachment is for; `title` and `data-path` carry where it
                 * actually lives, which is the part too long to draw.
                 */}
                <button
                  type="button"
                  data-field="detail-attachment-open"
                  data-attachment-id={attachment.id}
                  data-path={attachment.path}
                  title={attachment.path}
                  onClick={() => void openAttachment(attachment.id)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-[var(--text-primary)] hover:underline"
                >
                  {attachment.name ?? attachment.path}
                </button>
                {attachment.size !== null && (
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">
                    {sizeLabel(attachment.size)}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t('detail.attachments.remove', {
                    name: attachment.name ?? attachment.path,
                  })}
                  data-field="detail-attachment-remove"
                  data-attachment-id={attachment.id}
                  onClick={() => void removeAttachment(attachment.id)}
                  className="shrink-0 rounded px-1 text-xs text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--status-overdue)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {/*
         * A button rather than a drop zone: the file is chosen in the OS picker the
         * main process opens, so there is no path for a page to hand over and no
         * need for this window to know which files it is allowed to read (M03 S3).
         */}
        <button
          type="button"
          data-field="detail-attachment-add"
          onClick={() => void pickAttachments()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border-strong)] py-2 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
        >
          {`+ ${t('detail.attachments.add')}`}
        </button>
      </Group>

      {/*
       * Deletion is a soft delete, so the row still exists and the list's undo can
       * bring it back; there is no confirm dialog to interrupt with. The window closes
       * with it — there is nothing left to edit. It sits last and quiet: nothing on
       * this screen should be easier to hit than the fields being edited.
       */}
      <div className="mt-7 border-t border-[var(--border-default)] pt-3">
        <button
          type="button"
          data-field="detail-delete"
          onClick={() => void remove()}
          className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-muted)] hover:text-[var(--status-overdue)]"
        >
          <TrashGlyph />
          {t('detail.delete')}
        </button>
      </div>
    </div>
  );
}

/** Ticks one of the checklist's rows, and reads back through the announcement. */
function toggleSubtask(id: string, done: boolean): void {
  void window.api.task.update(id, { status: done ? 'done' : 'todo' });
}

/**
 * A size the eye can compare at a glance ("2.4 MB"); the exact byte count is noise
 * in a list this narrow.
 */
function sizeLabel(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/** The badge a file row shows. A name with no extension reads as no type at all. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'file';
  return name.slice(dot + 1);
}

/** The placeholder an image card draws when the platform could not preview it. */
function ImageGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-5 opacity-70"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-4.5-4.5L6 20" />
    </svg>
  );
}

/** The tick a finished subtask draws: a filled dot with nothing in it reads as "on". */
function CheckGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-2.5"
    >
      <path d="M2.6 6.3 4.9 8.6 9.4 3.6" />
    </svg>
  );
}

/** The trash a destructive action carries, so it is not just red words. */
function TrashGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="M2.8 4.2h10.4M6.4 4.2V3a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2M4 4.2l.6 8.1a1.4 1.4 0 0 0 1.4 1.3h4a1.4 1.4 0 0 0 1.4-1.3l.6-8.1M6.6 6.8v4M9.4 6.8v4" />
    </svg>
  );
}

/**
 * One subject of the form: what it is, and every control that belongs to it.
 *
 * The heading is what separates subjects on this screen — the old version framed every
 * field and had no headings, which cost eleven borders and still left the eye nothing to
 * navigate by. `aside` carries a count that belongs to the heading rather than to a
 * field, such as a checklist's progress.
 */
function Group({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="mt-6 flex flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </h2>
        {aside !== undefined && (
          <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{aside}</span>
        )}
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

/**
 * One field of the form: a label and its control, with nothing drawn around them.
 *
 * The label is a caption on the control rather than a second title, which is why it is
 * quieter and smaller than the group heading above it — three sizes of text, three
 * levels of importance: the task, its sections, and its field names.
 */
function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col">
      <span className="mb-1.5 text-[11px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </div>
  );
}

/**
 * A pressed switch: a plain button with `aria-pressed`, so tab order is the order
 * written. `dot` is the colour swatch that lets one be found by eye among several.
 *
 * Unpressed switches carry no edge — they sit on the same muted surface the text
 * fields use, so a row of them reads as a set of answers to one question rather than as
 * a toolbar of buttons. The pressed one is the only one with a border and a tint.
 *
 * `dashed` marks the one chip in a row that opens something instead of choosing a value
 * (`detail.repeat.custom`): it needs to not look like the seventh preset, and a dashed
 * edge is the smallest way to say "this one is different" without a second colour.
 */
function Choice({
  field,
  active = false,
  dot,
  dashed = false,
  onClick,
  children,
}: {
  field: string;
  active?: boolean;
  dot?: string;
  dashed?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      // The name the smoke harness puts the keyboard on (§13). See the note at the
      // top of this file.
      data-field={field}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-[5px] text-[11px] font-medium transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
          : dashed
            ? 'border-dashed border-[var(--border-strong)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            : 'border-transparent bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {dot !== undefined && (
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
