import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { TaskPriority, TaskStatus, TaskWithTags } from '@shared/types/task';
import { TASK_PRIORITIES, TASK_STATUSES } from '@shared/types/task';
import {
  dueToday,
  dueTomorrow,
  fromDueValues,
  toDateValue,
  toTimeValue,
  withDueTime,
} from '@shared/utils/task-dates';

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
