import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../../i18n/index.js';
import { installOffer, type InstallOffer } from '../../lib/install-app.js';
import {
  announceInstallOfferChange,
  heldInstallPrompt,
  onInstallOfferChange,
  releaseInstallPrompt,
} from '../../lib/install-capture.js';
import { Button } from '../ui/button.js';
import { Dialog } from '../ui/dialog.js';

/**
 * «تثبيت التطبيق», in the top menu (SRS Revision 167 §4). What it does depends
 * on the device — see `installOffer`, which owns that decision. Renders nothing
 * where there is nothing to offer, so it takes no room in an installed app.
 *
 * The browser's event is caught by `lib/install-capture.ts`, which `main.tsx`
 * loads first: it fires once, often before the header has mounted (since R209,
 * before this module has even loaded), and the header mounts twice.
 */
function currentOffer(): InstallOffer {
  if (typeof window === 'undefined') return 'none';
  return installOffer({
    promptAvailable: heldInstallPrompt() !== null,
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
    const stop = onInstallOfferChange(refresh);
    refresh();
    return () => {
      stop();
    };
  }, []);

  if (offer === 'none') return null;

  async function install(): Promise<void> {
    const prompt = heldInstallPrompt();
    if (offer === 'prompt' && prompt !== null) {
      // The event is single-use: once shown it can never be shown again.
      releaseInstallPrompt();
      await prompt.prompt();
      await prompt.userChoice.catch(() => undefined);
      announceInstallOfferChange();
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
