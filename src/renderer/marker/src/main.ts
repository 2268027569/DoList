import './marker.css';
import { applyBootParams, readBoot, smokeEnabled } from '../../shared-ui/boot';
import { attachDragBridge, clickIsSuppressed } from '../../shared-ui/drag';
import { changeLocale, initRendererI18n, t } from '../../shared-ui/i18n';
import { report } from '../../shared-ui/smoke';

/**
 * Marker entry — deliberately React-free (docs/ARCHITECTURE.md §2): a few DOM
 * nodes and CSS transitions keep the always-resident process at near-zero cost.
 */
void main();

async function main(): Promise<void> {
  const boot = readBoot();
  await initRendererI18n(boot.locale);

  const element = document.getElementById('marker');
  if (element === null) return;

  const smoke = smokeEnabled(boot);
  const bridge = attachDragBridge(element);

  setLabel(element);
  report(smoke, 'ready', { boot });

  let lastExpandAt = 0;
  const expand = (reason: string): void => {
    if (bridge.isDragging() || clickIsSuppressed()) {
      report(smoke, 'expand-suppressed', { reason });
      return;
    }
    const now = Date.now();
    if (now - lastExpandAt < 500) {
      report(smoke, 'expand-deduped', { reason });
      return;
    }
    lastExpandAt = now;
    report(smoke, 'expand', { reason });
    void window.api.window.expand();
  };

  // `click` is the primary trigger; `pointerup` is the fallback for the case
  // where the release happens while the pointer capture is already lost.
  element.addEventListener('click', (event) => {
    event.preventDefault();
    expand('click');
  });
  element.addEventListener('pointerup', () => {
    window.setTimeout(() => expand('pointerup'), 60);
  });

  // Hover reporting feeds the smoke harness and M01's hover ring.
  element.addEventListener('pointerenter', () => report(smoke, 'pointer-enter'));
  element.addEventListener('pointerleave', () => report(smoke, 'pointer-leave'));
  element.addEventListener('pointerdown', () => report(smoke, 'pointer-down'));
  element.addEventListener('contextmenu', (event) => {
    // Right-click menu arrives with M01; for now the default menu stays hidden.
    event.preventDefault();
  });

  window.api.on.panelState(({ state }) => {
    element.dataset['panel'] = state;
  });

  window.api.on.themeChanged((params) => {
    applyBootParams(params);
  });

  window.api.on.localeChanged(({ locale }) => {
    void changeLocale(locale).then(() => setLabel(element));
  });
}

function setLabel(element: HTMLElement): void {
  const label = t('marker.tooltip');
  element.setAttribute('aria-label', label);
  element.title = label;
}
