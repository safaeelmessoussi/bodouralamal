import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import {
  installOffer,
  type InstallOffer,
  type InstallPromptEvent,
} from '../../lib/install-app.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';

/**
 * «تثبيت التطبيق», in the top menu (SRS Revision 167 §4). What it does depends
 * on the device — see `installOffer`, which owns that decision. Renders nothing
 * where there is nothing to offer, so it takes no room in an installed app.
 *
 * The browser's event is held at MODULE level: it fires once, often before the
 * header has mounted, and the header mounts twice (desktop bar, mobile sheet).
 */
let heldPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome shows its own mini-infobar, once, at a moment of its
    // choosing; the Owner asked for a button she can find.
    event.preventDefault();
    heldPrompt = event as InstallPromptEvent;
    listeners.forEach((notify) => notify());
  });
  window.addEventListener('appinstalled', () => {
    heldPrompt = null;
    listeners.forEach((notify) => notify());
  });
}

function currentOffer(): InstallOffer {
  if (typeof window === 'undefined') return 'none';
  return installOffer({
    promptAvailable: heldPrompt !== null,
    standalone:
      // Not every WebView has `matchMedia`; absent means «not standalone».
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

export function InstallAppButton({ block = false }: { block?: boolean }): ReactNode {
  const [offer, setOffer] = useState<InstallOffer>(currentOffer);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const refresh = (): void => setOffer(currentOffer());
    listeners.add(refresh);
    refresh();
    return () => {
      listeners.delete(refresh);
    };
  }, []);

  if (offer === 'none') return null;

  async function install(): Promise<void> {
    if (offer === 'prompt' && heldPrompt !== null) {
      const prompt = heldPrompt;
      // The event is single-use: once shown it can never be shown again.
      heldPrompt = null;
      await prompt.prompt();
      await prompt.userChoice.catch(() => undefined);
      listeners.forEach((notify) => notify());
      return;
    }
    setHelpOpen(true);
  }

  const steps = offer === 'ios' ? 'ios' : 'manual';
  return (
    <>
      <Button variant="secondary" block={block} onClick={() => void install()} data-install-app={offer}>
        {t('install.button')}
      </Button>
      {/* Mounted only while open: the header is on every page, and a closed
          dialog parked at the top of each one is a node nothing needs — and the
          first `.dialog` any page-level query would find. */}
      {helpOpen ? (
        <Dialog open onClose={() => setHelpOpen(false)} title={t('install.title')}>
          <p>{t(`install.${steps}.lede`)}</p>
          <ol className="install-steps">
            <li>{t(`install.${steps}.step1`)}</li>
            <li>{t(`install.${steps}.step2`)}</li>
            <li>{t(`install.${steps}.step3`)}</li>
          </ol>
          <p className="field__hint">{t('install.note')}</p>
        </Dialog>
      ) : null}
    </>
  );
}
