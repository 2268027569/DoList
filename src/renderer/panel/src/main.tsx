import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import '../../shared-ui/panel.css';
import { readBoot } from '../../shared-ui/boot';
import { i18n, initRendererI18n } from '../../shared-ui/i18n';
import { App } from './App';

void start();

async function start(): Promise<void> {
  const boot = readBoot();
  await initRendererI18n(boot.locale, { icu: true });
  // Reuse the single renderer i18next instance instead of building a second one.
  initReactI18next.init(i18n);

  const container = document.getElementById('root');
  if (container === null) return;

  createRoot(container).render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  );
}
