import { beforeAll, describe, expect, it } from 'vitest';

import { initI18n, t } from './i18n';

/**
 * Guards the actual i18next + ICU wiring (§8): a mis-ordered plugin or a missing
 * `intl-messageformat` dependency silently degrades plurals to plain strings.
 */
describe('main-process i18n', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('translates a simple key', async () => {
    expect(t('app.name')).toBe('YiChen ToDo');
  });

  it('resolves ICU plurals for English', async () => {
    expect(t('tasks:summary.pending', { count: 0 })).toBe('Nothing left for today');
    expect(t('tasks:summary.pending', { count: 3 })).toBe('3 tasks left today');
  });

  it('resolves ICU plurals for Chinese', async () => {
    await initI18n('zh-Hans');
    expect(t('tasks:summary.pending', { count: 2 })).toBe('今天还有 2 项待办');
    await initI18n('en');
  });

  it('falls back to English for an unsupported locale', async () => {
    const locale = await initI18n('fr');
    expect(locale).toBe('en');
    expect(t('settings:title')).toBe('Settings');
  });
});
