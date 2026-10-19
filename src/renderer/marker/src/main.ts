import './marker.css';
import { DEFAULT_APPEARANCE, markerArtworkSize } from '@shared/utils/marker-geometry';
import type { MarkerStatePayload } from '@shared/contracts/channels';
import { applyBootParams, readBoot, smokeEnabled } from '../../shared-ui/boot';
import { attachDragBridge, clickIsSuppressed } from '../../shared-ui/drag';
import { report } from '../../shared-ui/smoke';
import { markerLabel } from './labels';

/**
 * Marker entry — deliberately React-free and i18next-free (docs/ARCHITECTURE.md
 * §2): a few DOM nodes, a static label table and CSS transitions keep the
 * always-resident process at near-zero cost.
 */
main();

function main(): void {
  const boot = readBoot();

  const element = document.getElementById('marker');
  if (element === null) return;
  const counter = element.querySelector('.marker__count');

  const smoke = smokeEnabled(boot);
  const bridge = attachDragBridge(element);

  let locale = boot.locale;
  let badge = 0;
  setLabel(element, locale, badge);

  // The first paint uses the boot appearance so the marker never flashes a shape
  // the window was not sized for; the pushed state then keeps it current (§9.5).
  applyState(element, counter, {
    appearance: boot.marker ?? DEFAULT_APPEARANCE,
    badge,
    progress: null,
    risk: 'neutral',
  });
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
    // The app menu (新建任务 / 今日 / 退出) is asked for, never built here: its
    // labels come from the main i18n instance and its actions open windows or quit
    // the app, which a renderer may not do (§6.5). The default browser menu — which
    // would offer "Reload" on a window that must never accidentally reload — stays
    // suppressed.
    event.preventDefault();
    report(smoke, 'context-menu');
    void window.api.marker.contextMenu();
  });

  window.api.on.markerState((state) => {
    badge = state.badge;
    applyState(element, counter, state);
    setLabel(element, locale, badge);
    report(smoke, 'marker-state-applied', {
      shape: state.appearance.shape,
      badge: state.badge,
      progress: state.progress,
      risk: state.risk,
    });
  });

  window.api.on.panelState(({ state }) => {
    element.dataset['panel'] = state;
  });

  window.api.on.themeChanged((params) => {
    applyBootParams(params);
  });

  window.api.on.localeChanged((params) => {
    locale = params.locale;
    setLabel(element, locale, badge);
  });
}

/** Writes an appearance + counts pair onto the DOM and the token scope. */
function applyState(
  element: HTMLElement,
  counter: Element | null,
  state: MarkerStatePayload,
): void {
  const { appearance, badge, progress, risk } = state;
  const root = document.documentElement;
  root.dataset['markerTint'] = appearance.tint;
  root.dataset['markerRisk'] = risk;

  const artwork = markerArtworkSize(appearance.shape, appearance.scale);
  element.dataset['shape'] = appearance.shape;
  element.dataset['badge'] = badge > 0 ? 'on' : 'off';
  element.dataset['ring'] = appearance.showRing && progress !== null ? 'on' : 'off';
  element.style.setProperty('--marker-w', `${artwork.width}px`);
  element.style.setProperty('--marker-h', `${artwork.height}px`);
  element.style.setProperty('--marker-opacity', String(appearance.opacity));
  element.style.setProperty('--marker-progress', String(progress ?? 0));

  if (counter !== null) counter.textContent = badge > 0 ? String(badge) : '';
}

function setLabel(element: HTMLElement, locale: string, badge: number): void {
  const label = markerLabel(locale, 'marker.tooltip');
  element.setAttribute('aria-label', badge > 0 ? `${label} · ${badge}` : label);
  element.title = label;
}
