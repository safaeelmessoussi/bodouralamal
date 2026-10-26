import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { t } from "../../i18n/index.js";
import {
  installOffer,
  isInstalledHere,
  type InstallOffer,
} from "../../lib/install-app.js";
import {
  announceInstallOfferChange,
  heldInstallPrompt,
  onInstallOfferChange,
  releaseInstallPrompt,
} from "../../lib/install-capture.js";
import { Button } from "../ui/button.js";
import { Dialog } from "../ui/dialog.js";

/**
 * «تثبيت التطبيق», in the top menu (SRS Revision 167 §4). What it does depends
 * on the device — see `installOffer`, which owns that decision. Renders nothing
 * where there is nothing to offer, so it takes no room in an installed app.
 *
 * The browser's event is caught by `lib/install-capture.ts`, which `main.tsx`
 * loads first: it fires once, often before the header has mounted (since R209,
 * before this module has even loaded), and the header mounts twice.
 */
let installedHere = false;

/** R244 — how long a tap waits for the browser's offer before explaining instead. */
const OFFER_WAIT_MS = 2500;

/**
 * Chrome sends its offer only after the reader has interacted with the page,
 * so the first tap may come before it: wait for it briefly, then open the
 * browser's own sheet — still within the tap's activation.
 */
function waitForPrompt(ms: number): Promise<boolean> {
  if (heldInstallPrompt() !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stop();
      resolve(false);
    }, ms);
    const stop = onInstallOfferChange(() => {
      if (heldInstallPrompt() === null) return;
      window.clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}

function currentOffer(): InstallOffer {
  if (typeof window === "undefined") return "none";
  return installOffer({
    promptAvailable: heldInstallPrompt() !== null,
    installed: installedHere,
    standalone:
      // Not every WebView has `matchMedia`; absent means «not standalone».
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

export function InstallAppButton({
  block = false,
}: {
  block?: boolean;
}): ReactNode {
  const [offer, setOffer] = useState<InstallOffer>(currentOffer);
  const [helpOpen, setHelpOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const refresh = (): void => setOffer(currentOffer());
    const stop = onInstallOfferChange(refresh);
    refresh();
    void isInstalledHere().then((yes) => {
      installedHere = yes;
      refresh();
    });
    return () => {
      stop();
    };
  }, []);

  if (offer === "none") return null;

  async function install(): Promise<void> {
    // R244 — a browser that has not made its offer yet may make it now.
    if (offer === "manual") {
      setWaiting(true);
      await waitForPrompt(OFFER_WAIT_MS);
      setWaiting(false);
    }
    const prompt = heldInstallPrompt();
    if (prompt !== null) {
      // The event is single-use: once shown it can never be shown again.
      releaseInstallPrompt();
      try {
        await prompt.prompt();
        await prompt.userChoice.catch(() => undefined);
        announceInstallOfferChange();
        return;
      } catch {
        // The browser refused its sheet (the tap's activation had passed): the steps instead.
      }
    }
    setHelpOpen(true);
  }

  const steps = offer === "ios" ? "ios" : "manual";
  return (
    <>
      <Button
        variant="secondary"
        block={block}
        disabled={waiting}
        aria-busy={waiting}
        onClick={() => void install()}
        data-install-app={offer}
      >
        {t("install.button")}
      </Button>
      {/* Mounted only while open: the header is on every page, and a closed
          dialog parked at the top of each one is a node nothing needs — and the
          first `.dialog` any page-level query would find. R244 — and in the
          page's body, not in the menu sheet that holds the button: inside the
          sheet (hidden on a laptop, closing on a phone) an iPhone drew it as a
          thin white line, and a hidden one as nothing at all. */}
      {helpOpen
        ? createPortal(
            <Dialog
              open
              onClose={() => setHelpOpen(false)}
              title={t("install.title")}
            >
              {offer === "installed" ? (
                <p>{t("install.installed")}</p>
              ) : (
                <>
                  <p>{t(`install.${steps}.lede`)}</p>
                  <ol className="install-steps">
                    <li>{t(`install.${steps}.step1`)}</li>
                    <li>{t(`install.${steps}.step2`)}</li>
                    <li>{t(`install.${steps}.step3`)}</li>
                  </ol>
                </>
              )}
              <p className="field__hint">{t("install.note")}</p>
            </Dialog>,
            document.body,
          )
        : null}
    </>
  );
}
