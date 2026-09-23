import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { linkSessionContent } from '../../adapters/sessions.js';
import { useSession } from '../../contexts/session.js';
import { t } from '../../i18n/index.js';
import { recordingSession } from '../../lib/recording-platform.js';
import { AudioRecorder, hostsMounted, subscribeHosts } from './audio-recorder.js';

/**
 * **The recording, wherever she is** (SRS Revision 172 §4).
 *
 * Mounted once, at the application root. While a recording is active and no
 * screen is showing it (she left the page it was started from), this bar
 * stands at the bottom of every page with the same controls — pause, stop,
 * name, save, discard — and a link back to where it began. The moment a
 * screen shows the recording again, the bar stands down.
 *
 * It is also where a recording a dead page left in the browser's storage is
 * offered back: `restore()` runs once at start-up, and what it finds appears
 * here as a stopped recording with «حفظ» and «حذف».
 *
 * A recording started from a class occurrence is linked to it on save, as the
 * materials dialog would have done — the origin carries the session id.
 */
export function RecordingBar(): ReactNode {
  const session = recordingSession();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const hosts = useSyncExternalStore(subscribeHosts, hostsMounted);
  const { accessToken } = useSession();

  useEffect(() => {
    void session.restore();
  }, [session]);

  // R75.7's two guards, now application-wide: the page hidden while recording
  // is noted (and the screen lock re-taken when it returns), and closing or
  // reloading the tab asks first — the audio survives it, the capture does not.
  useEffect(() => {
    const visibility = (): void => {
      if (document.visibilityState === 'hidden') session.noteBackgrounded();
      else session.noteVisible();
    };
    const warn = (event: BeforeUnloadEvent): void => {
      const { status } = session.getSnapshot();
      if (status !== 'recording' && status !== 'paused') return;
      event.preventDefault();
      // Browsers show their own wording; assigning is what arms the dialog.
      event.returnValue = '';
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', warn);
    };
  }, [session]);

  if (state.status === 'idle' || state.origin === null || hosts > 0) return null;

  const origin = state.origin;
  return (
    <div className="recording-bar" role="region" aria-label={t('recorder.barLabel')}>
      <p className="recording-bar__where">
        <span aria-hidden="true" className="recorder__dot" />
        {t('recorder.barWhere').replace('{label}', origin.label)}
      </p>
      <AudioRecorder
        compact
        origin={origin}
        meta={state.meta ?? { level_id: '', subject_id: '', academic_year_id: '', branch_id: null }}
        token={accessToken}
        suggestedName={state.suggestedName}
        saveBlockedReason={state.meta === null ? t('recorder.returnToSave') : state.saveBlockedReason}
        onSaved={(contentId) => {
          if (origin.sessionId !== null) {
            // Upload then link, in that order and for the same reason the
            // materials dialog has: a failed link leaves a usable file in the
            // library rather than an orphaned object.
            void linkSessionContent(origin.sessionId, contentId, accessToken).catch(() => undefined);
          }
        }}
        onCancel={() => undefined}
      />
    </div>
  );
}
