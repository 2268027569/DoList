import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { usePanelStore } from './store';

/**
 * One-line quick add (docs/FEATURES.md M02, M02-PLAN §6).
 *
 * `Enter` stores the task and keeps the caret in the field, so several tasks can
 * be typed in a row. The shortcut that opens the panel with the caret already
 * here sends `event:quick-add-focus`, which is the only thing this component
 * listens for.
 */
export function QuickAdd(): ReactElement {
  const { t } = useTranslation('tasks');
  const addTask = usePanelStore((state) => state.addTask);
  const [title, setTitle] = useState('');
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Whether the caret really landed here is checked from outside the renderer by
    // the smoke harness, over the debugger protocol (§13) — no report needed.
    return window.api.on.quickAddFocus(() => {
      field.current?.focus();
    });
  }, []);

  const submit = async (): Promise<void> => {
    const trimmed = title.trim();
    // Whitespace alone is not a task; leave the text as typed so it is not eaten.
    if (trimmed === '') return;

    setTitle('');
    const stored = await addTask(trimmed);
    // A rejected write hands the text back rather than losing what was typed.
    if (!stored) setTitle(title);
    field.current?.focus();
  };

  return (
    <input
      ref={field}
      type="text"
      value={title}
      aria-label={t('quickAdd.placeholder')}
      placeholder={t('quickAdd.placeholder')}
      // The harness's address for this control: it focuses the panel's fields by
      // name over the DevTools protocol rather than by pressing Tab (§13).
      data-field="quick-add"
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submit();
      }}
      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
    />
  );
}
