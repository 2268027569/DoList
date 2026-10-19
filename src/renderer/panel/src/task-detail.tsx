import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatMode, TaskPriority, TaskStatus, TaskWithTags } from '@shared/types/task';
import { REPEAT_MODES, TASK_PRIORITIES, TASK_STATUSES } from '@shared/types/task';
import {
  dueToday,
  dueTomorrow,
  fromDueValues,
  toDateValue,
  toTimeValue,
  withDueTime,
} from '@shared/utils/task-dates';
import { progressText } from '@shared/utils/task-tree';

import { REPEAT_PRESETS, presetFor } from './repeat-presets';
import { usePanelStore } from './store';

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

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'status.todo',
  doing: 'status.doing',
  done: 'status.done',
  cancelled: 'status.cancelled',
};

/** The two ways a repeat can count, named for the field and for the label key. */
const REPEAT_MODE_LABEL: Record<RepeatMode, string> = {
  fixed: 'detail.repeat.fixed',
  after_completion: 'detail.repeat.afterCompletion',
};

const INPUT =
  'w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]';

/**
 * The task detail, a full-screen replacement of the list (M02 D6): the panel is
 * 320–640 DIP wide, where a list beside anything readable is no longer readable.
 *
 * Saving is immediate (M02 D9) — there is no save button and no dirty flag, which
 * is also what makes the panel's collapse-on-blur safe: whatever was typed is
 * stored before the user leaves. Free text and the two date controls commit when
 * the field is left (or on Enter); a switch commits as it is thrown.
 *
 * Every control carries a `data-field` name. They are what the smoke harness reads
 * to find out where the keyboard went (§13): it attaches to this page over the
 * DevTools protocol and puts the keyboard on a control **by name**, rather than
 * counting Tab presses — which never worked, because Chromium only honours focus
 * navigation while the window really holds the foreground. New controls get a name
 * too, or the harness cannot ask for them.
 */
export function TaskDetail({
  task,
  onBack,
}: {
  task: TaskWithTags;
  onBack: () => void;
}): ReactElement {
  const { t } = useTranslation('tasks');
  const saveOpenTask = usePanelStore((state) => state.saveOpenTask);
  const deleteOpenTask = usePanelStore((state) => state.deleteOpenTask);
  const saveFailed = usePanelStore((state) => state.saveFailed);
  const subtasks = usePanelStore((state) => state.subtasks);
  const addSubtask = usePanelStore((state) => state.addSubtask);
  const removeSubtask = usePanelStore((state) => state.removeSubtask);
  const attachments = usePanelStore((state) => state.attachments);
  const pickAttachments = usePanelStore((state) => state.pickAttachments);
  const removeAttachment = usePanelStore((state) => state.removeAttachment);
  const openAttachment = usePanelStore((state) => state.openAttachment);
  const toggleTask = usePanelStore((state) => state.toggleTask);

  /**
   * Seeded from the row once rather than kept in step with every re-read: a
   * refresh landing mid-word would replace what the user is typing. The row
   * itself is re-read after each write, so what is shown as saved is current.
   * Only the free-text fields and the date controls need this — the switches
   * below render the row directly.
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

  useEffect(() => {
    // The harness cannot click, so this is the one moment it needs to know the
    // detail opened on the expected row with the caret already in its title.
    void window.api.smoke.report('detail-opened', {
      taskId: opened.id,
      title: opened.title,
      focused: document.activeElement === titleField.current,
    });
    return () => {
      void window.api.smoke.report('detail-closed', { taskId: opened.id });
    };
  }, [opened]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  /** A blank title is not a task; the field falls back to what the row holds. */
  const commitTitle = (): void => {
    const next = title.trim();
    if (next === '' || next === task.title) {
      setTitle(task.title);
      return;
    }
    void saveOpenTask({ title: next });
  };

  const commitNotes = (): void => {
    const next = notes.trim() === '' ? null : notes;
    if (next === (task.notes ?? null)) return;
    void saveOpenTask({ notes: next });
  };

  const commitDue = (date = dueDate, time = dueTime, includeTime = hasTime): void => {
    const next = fromDueValues(date, time, includeTime);
    if (next === task.dueAt && includeTime === task.dueHasTime) return;
    void saveOpenTask({ dueAt: next, dueHasTime: includeTime });
  };

  /** A preset is a day, not an instant, so it drops any clock time with it. */
  const applyPreset = (dayStart: number): void => {
    setDueDate(toDateValue(dayStart));
    setDueTime(toTimeValue(dayStart));
    setHasTime(false);
    void saveOpenTask({ dueAt: dayStart, dueHasTime: false });
  };

  const clearDue = (): void => {
    setDueDate('');
    setDueTime('');
    setHasTime(false);
    void saveOpenTask({ dueAt: null, dueHasTime: false });
  };

  const toggleHasTime = (includeTime: boolean): void => {
    setHasTime(includeTime);
    const day = fromDueValues(dueDate, dueTime, includeTime);
    // No date yet: the switch was the whole change, and it waits on the date.
    if (day === null) {
      void saveOpenTask({ dueHasTime: includeTime });
      return;
    }
    const at = withDueTime(day, includeTime);
    setDueTime(toTimeValue(at));
    void saveOpenTask({ dueAt: at, dueHasTime: includeTime });
  };

  const commitRemind = (): void => {
    const trimmed = remind.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setRemind(task.remindLeadMin === null ? '' : String(task.remindLeadMin));
      return;
    }
    if (next === task.remindLeadMin) return;
    void saveOpenTask({ remindLeadMin: next });
  };

  const addTag = (): void => {
    const name = tagDraft.trim();
    setTagDraft('');
    if (name === '' || task.tags.includes(name)) return;
    void saveOpenTask({ tags: [...task.tags, name] });
  };

  const removeTag = (name: string): void => {
    void saveOpenTask({ tags: task.tags.filter((tag) => tag !== name) });
  };

  /**
   * Throws one of the preset switches: the rule it names, or turning the repeat off
   * when it is already the active one. A single control that both sets and clears
   * keeps the row from needing a separate "none" button to say the same thing.
   */
  const choosePreset = (rule: string): void => {
    setRepeatOpen(false);
    setCustomRepeat('');
    void saveOpenTask({ repeatRule: task.repeatRule === rule ? null : rule });
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
    void saveOpenTask({ repeatRule: rule === '' ? null : rule });
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('detail.back')}
          data-field="detail-back"
          className="rounded-md px-1.5 py-0.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
        >
          ←
        </button>
        <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
          {t('detail.heading')}
        </h1>
        {saveFailed && (
          <span className="ml-auto text-[11px] text-[var(--status-overdue)]">
            {t('detail.saveFailed')}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
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
          className={`${INPUT} font-medium`}
        />

        <Field label={t('detail.notes')}>
          <textarea
            rows={3}
            value={notes}
            data-field="detail-notes"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={commitNotes}
            className={`${INPUT} resize-y`}
          />
        </Field>

        <Field label={t('detail.due')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={dueDate}
              aria-label={t('detail.due')}
              data-field="detail-due-date"
              onChange={(event) => setDueDate(event.target.value)}
              onBlur={() => commitDue()}
              className={`${INPUT} w-auto`}
            />
            <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={hasTime}
                data-field="detail-has-time"
                onChange={(event) => toggleHasTime(event.target.checked)}
              />
              {t('detail.hasTime')}
            </label>
            {hasTime && (
              <input
                type="time"
                value={dueTime}
                aria-label={t('detail.time')}
                data-field="detail-due-time"
                onChange={(event) => setDueTime(event.target.value)}
                onBlur={() => commitDue()}
                className={`${INPUT} w-auto`}
              />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
              className={`${INPUT} mt-1.5 font-mono text-xs`}
            />
          )}

          {/*
           * The mode is only meaningful once there is a rule to count, so it stays
           * out of the way until then.
           */}
          {task.repeatRule !== null && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REPEAT_MODES.map((mode) => (
                <Choice
                  key={mode}
                  field={`detail-repeat-mode-${mode}`}
                  active={(task.repeatMode ?? 'fixed') === mode}
                  onClick={() => void saveOpenTask({ repeatMode: mode })}
                >
                  {t(REPEAT_MODE_LABEL[mode])}
                </Choice>
              ))}
            </div>
          )}
        </Field>

        <Field label={t('detail.remind')}>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={remind}
            placeholder={t('detail.none')}
            data-field="detail-remind"
            onChange={(event) => setRemind(event.target.value)}
            onBlur={commitRemind}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitRemind();
            }}
            className={INPUT}
          />
        </Field>

        <Field label={t('detail.priority')}>
          <div className="flex flex-wrap gap-1.5">
            {TASK_PRIORITIES.map((level) => (
              <Choice
                key={level}
                field={`detail-priority-${PRIORITY_FIELD[level]}`}
                active={task.priority === level}
                onClick={() => void saveOpenTask({ priority: level })}
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
                onClick={() => void saveOpenTask({ status: value })}
              >
                {t(STATUS_LABEL[value])}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label={t('detail.tags')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[11px] leading-4 text-[var(--text-muted)]"
              >
                {`#${tag}`}
                <button
                  type="button"
                  aria-label={t('detail.tags.remove', { name: tag })}
                  data-field="detail-tag-remove"
                  onClick={() => removeTag(tag)}
                  className="text-[var(--text-muted)] hover:text-[var(--status-overdue)]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
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
            className={`${INPUT} mt-1.5`}
          />
        </Field>

        <Field
          label={
            subtaskProgress === null
              ? t('detail.subtasks')
              : `${t('detail.subtasks')} · ${subtaskProgress}`
          }
        >
          <ul className="flex flex-col gap-0.5">
            {subtasks.map((subtask) => {
              const done = subtask.status === 'done';
              return (
                <li key={subtask.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={t(done ? 'row.markUndone' : 'row.markDone')}
                    data-field="detail-subtask-toggle"
                    data-task-id={subtask.id}
                    onClick={() => void toggleTask(subtask.id, !done)}
                    className={`size-3.5 shrink-0 rounded-full border transition-colors ${
                      done
                        ? 'border-[var(--status-done)] bg-[var(--status-done)]'
                        : 'border-[var(--border-strong)] hover:border-[var(--accent)]'
                    }`}
                  />
                  <span
                    className={`min-w-0 flex-1 text-xs break-words ${
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
                    className="shrink-0 rounded px-1 text-xs text-[var(--text-muted)] hover:text-[var(--status-overdue)]"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {/*
           * Below the list rather than above it: adding one does not push the field
           * the caret is in down the screen, so a run of them can be typed without
           * the panel scrolling under the user.
           */}
          <input
            ref={subtaskField}
            type="text"
            value={subtaskDraft}
            placeholder={t('detail.subtasks.add')}
            aria-label={t('detail.subtasks.add')}
            data-field="detail-subtask-input"
            onChange={(event) => setSubtaskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              addSubtaskFromDraft();
            }}
            className={`${INPUT} mt-1.5`}
          />
        </Field>

        <Field label={t('detail.attachments')}>
          <ul className="flex flex-col gap-0.5">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2">
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
                  className="min-w-0 flex-1 truncate text-left text-xs text-[var(--text-primary)] hover:underline"
                >
                  {attachment.name ?? attachment.path}
                </button>
                {attachment.size !== null && (
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
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
                  // The row goes; the file does not. The app never owns the file, and
                  // a click in a task list is no place to delete a document (S7).
                  onClick={() => void removeAttachment(attachment.id)}
                  className="shrink-0 rounded px-1 text-xs text-[var(--text-muted)] hover:text-[var(--status-overdue)]"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {/*
           * A button rather than a drop zone: the file is chosen in the OS picker the
           * main process opens, so there is no path for a page to hand over and no
           * need for the panel to know which files it is allowed to read (S7).
           */}
          <button
            type="button"
            data-field="detail-attachment-add"
            onClick={() => void pickAttachments()}
            className="mt-1.5 self-start rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            {t('detail.attachments.add')}
          </button>
        </Field>

        {/*
         * Deletion is a soft delete, so the row still exists and M02 S7's undo can
         * bring it back; there is no confirm dialog to interrupt with, which is
         * what the panel's "no modal" shape would otherwise have to host.
         */}
        <button
          type="button"
          data-field="detail-delete"
          onClick={() => void deleteOpenTask()}
          className="mt-1 self-start rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--status-overdue)] hover:bg-[var(--bg-surface-muted)]"
        >
          {t('detail.delete')}
        </button>
      </div>
    </div>
  );
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

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

/** A pressed switch: a plain button with `aria-pressed`, so tab order is the order written. */
function Choice({
  field,
  active = false,
  onClick,
  children,
}: {
  field: string;
  active?: boolean;
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
      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--bg-surface-muted)] text-[var(--text-primary)]'
          : 'border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
