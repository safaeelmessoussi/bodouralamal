import { afterEach, describe, expect, it } from 'vitest';

import { applyLocale, activeLocale, t, tList } from '../i18n/index.js';
import { isLocale, resolveLocale, translatesHere } from './locale.js';

describe('R209 — which language a page reads in', () => {
  it('translates the three public pages only', () => {
    for (const path of ['/', '/calendar', '/resources']) expect(translatesHere(path), path).toBe(true);
    for (const path of ['/login', '/dashboard/student', '/admin', '/teacher', '/privacy', '/nowhere']) {
      expect(translatesHere(path), path).toBe(false);
    }
  });

  it('a link’s ?lang= first, then the device’s choice, then Arabic — and Arabic off the public pages', () => {
    expect(resolveLocale('/calendar', '?lang=fr', 'en')).toBe('fr');
    expect(resolveLocale('/calendar', '', 'en')).toBe('en');
    expect(resolveLocale('/calendar', '?lang=xx', 'de')).toBe('de');
    expect(resolveLocale('/calendar', '', 'klingon')).toBe('ar');
    expect(resolveLocale('/', '', null)).toBe('ar');
    expect(resolveLocale('/login', '?lang=en', 'en')).toBe('ar');
    expect(resolveLocale('/admin', '', 'zgh')).toBe('ar');
    expect(isLocale('shi-Latn') && isLocale('zgh') && !isLocale('ber')).toBe(true);
  });
});

describe('R209 — a translation falls back to Arabic, key by key', () => {
  afterEach(() => applyLocale('ar', null));

  it('reads the translation where it has the key, Arabic where it does not', () => {
    applyLocale('en', { 'nav.home': 'Home', 'calendar.months': ['January'] });
    expect(activeLocale()).toBe('en');
    expect(t('nav.home')).toBe('Home');
    expect(t('nav.login')).toBe(t('nav.login', 'ar'));
    expect(t('nav.login')).not.toBe('nav.login');
    expect(tList('calendar.months')).toEqual(['January']);
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('a language whose translation did not load stays Arabic', () => {
    applyLocale('de', null);
    expect(activeLocale()).toBe('ar');
  });
});
