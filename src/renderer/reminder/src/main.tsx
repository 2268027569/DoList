import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import { REMINDER_POPUP_QUERY_KEY, parseReminderPopupPayload } from '@shared/contracts/reminder';

import { readBoot, smokeEnabled } from '../../shared-ui/boot';
import { i18n, initRendererI18n } from '../../shared-ui/i18n';
import { ReminderPopup } from './reminder-popup';
import './reminder.css';

/**
 * The reminder popup's entry (docs/FEATURES.md M04).
 *
 * It is its own window and its own page, not a card inside the panel: a reminder has to
 * reach the user without the panel unfolding over whatever they were doing, so the two
 * surfaces are separate and the panel is only opened when its notification is clicked.
 *
 * The payload arrives in the query string (load-renderer.ts) rather than over IPC, so the
 * first frame is already the right reminder. Without a payload there is nothing to say —
 * the card's four fields are the whole announcement — and the window stays empty for the
 * main process to close.
 *
 * ICU is registered like the panel's, because the shipped strings are ICU-formatted and
 * the popup's due line interpolates one (`reminder.due`); a plain i18next would hand that
 * string back with its `{time}` still in it (§8).
 */
void start();

async function start(): Promise<void> {
  const boot = readBoot();
  const payload = parseReminderPopupPayload(
    new URLSearchParams(window.location.search).get(REMINDER_POPUP_QUERY_KEY),
  );

  const container = document.getElementById('root');
  if (payload === null || container === null) return;

  await initRendererI18n(boot.locale, { icu: true });
  // The shared renderer instance, bound to React — the same one the panel binds.
  initReactI18next.init(i18n);

  createRoot(container).render(
    <StrictMode>
      <ReminderPopup payload={payload} locale={boot.locale} smoke={smokeEnabled(boot)} />
    </StrictMode>,
  );
}
