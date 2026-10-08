// First: Chrome's one-time install offer must find its listener (R167 §4).
import './lib/install-capture.js';
import { prepareLocale } from './lib/locale.js';

/**
 * **SRS Revision 209 — the language first, then the application.** The page's
 * language (Arabic everywhere but the three public pages, where the reader may
 * choose another) is settled and its translation loaded before any screen
 * module is imported, so even a label computed at import time reads in it.
 */
void prepareLocale()
  .catch(() => 'ar')
  .then(() => import('./app.js'))
  .then(({ start }) => start());
