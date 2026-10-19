import { Menu, app } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';

import { createLogger } from '../logger';
import { t } from '../i18n';
import { expandPanelForQuickAdd, expandPanelForToday } from '../windows/panel';
import { isSmokeEnabled, smokeRecord } from './smoke';

const log = createLogger('platform/app-menu');

interface AppMenuAction {
  label: string;
  run: () => void;
}

/**
 * The action menu (docs/FEATURES.md M01 「标记 / 托盘菜单」), built once and opened
 * from both entry points: the tray icon's context menu and the marker's right-click.
 * Two surfaces with one list, so an action cannot exist on one and be missing from
 * the other.
 *
 * 打开设置 and 暂停提醒 are deliberately not here: the settings centre is M10 and
 * reminders are M04. A menu item that does nothing when clicked is worse than a
 * shorter menu, so they arrive with the milestones that can answer them
 * (docs/M02-PLAN.md §8, slice S8).
 */
function menuActions(): AppMenuAction[] {
  return [
    { label: t('action.newTask'), run: () => void expandPanelForQuickAdd() },
    { label: t('action.today'), run: () => void expandPanelForToday() },
  ];
}

/** The menu as a live object, so Electron owns the popup and its dismissal. */
export function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...menuActions().map((action) => ({ label: action.label, click: action.run })),
    { type: 'separator' },
    { label: t('action.quit'), click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * Opens the menu for the marker's right-click.
 *
 * Under the marker harness (`YICHEN_SMOKE_MENU_PICK=n`) the list is published and
 * the nth item is *run* instead of being popped up. A native menu cannot be
 * clicked from a script, and what the harness needs to prove is that a right-click
 * reaches the menu and that the chosen action really runs — the popup itself is
 * one Electron call with no branch of ours in it. Everything else in the chain is
 * real: the right-click, the channel, the labels from i18n, the action.
 */
export function popupAppMenu(window: BrowserWindow | null): void {
  const actions = menuActions();
  smokeRecord('app-menu', { labels: [...actions.map((action) => action.label), t('action.quit')] });

  const pick = smokeMenuPick();
  if (pick !== null) {
    const action = actions[pick];
    if (action === undefined) {
      log('the harness asked for a menu item that does not exist', { pick });
      return;
    }
    smokeRecord('app-menu-picked', { index: pick, label: action.label });
    action.run();
    return;
  }

  // Anchored to the marker: the click that asked for the menu happened on it, and a
  // non-focusable window is never the focused one Electron would default to.
  buildAppMenu().popup({ window: window ?? undefined });
}

/** The nth item the harness wants run, or `null` in a real run. */
function smokeMenuPick(): number | null {
  if (!isSmokeEnabled()) return null;
  const raw = process.env['YICHEN_SMOKE_MENU_PICK'];
  if (raw === undefined) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}
