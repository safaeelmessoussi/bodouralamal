import { useEffect, useState, type ReactNode } from 'react';

import { requestJoin, type JoinCredentials } from '../adapters/online-class.js';
import { OnlineClassroom } from '../components/classroom/online-classroom.js';
import { ApplicationHeader } from '../components/header/application-header.js';
import { Button, ButtonLink } from '../components/ui/button.js';
import { useActiveChild } from '../contexts/active-child.js';
import { useSession } from '../contexts/session.js';
import { t } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';

/**
 * `/classroom/{sessionId}` — **the platform's own classroom** (R98.20).
 *
 * **One route for everybody.** A مستفيدة, a guardian acting for her daughter, a
 * مؤطِّرة, her assistant and an administrator all arrive here; the server decides
 * who each of them is and what they may do, and this page renders whichever
 * classroom the answer implies. There is deliberately no `/teacher/classroom`
 * and no `/dashboard/student/classroom`: three copies of a live media surface is
 * three places for a media bug to be fixed in two of.
 *
 * **The credential is requested when the page opens and is never stored.** It is
 * short-lived and bound to one participant and one room; putting it in
 * `sessionStorage` would give it a life longer than the class and a scope wider
 * than the tab. Leaving discards it, and rejoining asks again — which is a
 * fresh authorization check, not a cached answer.
 *
 * **Every refusal is a sentence in Arabic naming the next step** (R98.23). The
 * server answers with a TD-3.8 envelope carrying a `reason`, and this page maps
 * each one — it never renders `error.message`, which is written for an operator
 * and often names a route, a constraint or a setting.
 */
type Phase =
  | { name: 'anonymous' }
  | { name: 'joining' }
  | { name: 'inside'; credentials: JoinCredentials }
  | { name: 'left' }
  | { name: 'refused'; message: string };

export function ClassroomPage(): ReactNode {
  const { accessToken } = useSession();
  const { activeChildId } = useActiveChild();
  const sessionId = window.location.pathname.split('/').pop() ?? '';

  const [phase, setPhase] = useState<Phase>({ name: 'joining' });
  /** Incremented by «إعادة الدخول». A fresh token for the same class, which is
   *  the whole of rejoining: nothing was created the first time, so nothing is
   *  duplicated the second (R98.17). */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken) {
      setPhase({ name: 'anonymous' });
      return;
    }
    let live = true;
    setPhase({ name: 'joining' });
    void (async () => {
      try {
        const credentials = await requestJoin(sessionId, accessToken, activeChildId);
        if (live) setPhase({ name: 'inside', credentials });
      } catch (error) {
        if (live) setPhase({ name: 'refused', message: refusalMessage(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, accessToken, activeChildId, attempt]);

  return (
    <>
      <ApplicationHeader />
      <main id="main" className="container">
        <h1 className="page-title">{t('classroom.title')}</h1>

        {/**
         * An anonymous reader can reach this URL by typing it. She is told she
         * must sign in — never handed a credential, and never shown a room
         * (R98.30). The public calendar may say «عن بُعد»; it can never open a
         * teaching room.
         */}
        {phase.name === 'anonymous' ? (
          <div className="state" role="status">
            <p>{t('classroom.notAllowed')}</p>
            <ButtonLink variant="secondary" href="/login">
              {t('nav.login')}
            </ButtonLink>
          </div>
        ) : null}

        {phase.name === 'joining' ? (
          <p className="state">{t('classroom.connecting')}</p>
        ) : null}

        {phase.name === 'refused' ? (
          <div className="state" role="status">
            <p>{phase.message}</p>
            <div className="classroom__exit">
              <ButtonLink variant="secondary" href="/calendar">
                {t('classroom.back')}
              </ButtonLink>
            </div>
          </div>
        ) : null}

        {phase.name === 'inside' ? (
          <OnlineClassroom
            credentials={phase.credentials}
            onLeave={() => setPhase({ name: 'left' })}
          />
        ) : null}

        {phase.name === 'left' ? (
          <div className="state" role="status">
            <p>{t('classroom.disconnected')}</p>
            <div className="classroom__exit">
              <Button onClick={() => setAttempt((n) => n + 1)}>
                {t('classroom.rejoin')}
              </Button>
              <ButtonLink variant="secondary" href="/calendar">
                {t('classroom.back')}
              </ButtonLink>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}

/**
 * The server's `reason` in the reader's words.
 *
 * The mapping is exhaustive over what `authorizeJoin` can answer, and its
 * fallback is a sentence rather than a code: a reason added server-side must
 * degrade to something readable, not to an empty page.
 */
export function refusalMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('classroom.failed');

  // §20 rule 17 — the server does not distinguish *«no such class»* from
  // *«not yours»*, and neither does this sentence.
  if (error.status === 404) return t('classroom.notAllowed');
  if (error.code === 'SERVICE_UNAVAILABLE') return t('classroom.unavailable');
  if (error.status === 401) return t('classroom.expired');

  const reason = error.details['reason'];
  if (reason === 'NOT_ONLINE') return t('classroom.notOnline');
  if (reason === 'CANCELLED') return t('classroom.cancelled');
  if (reason === 'BEFORE_WINDOW') return t('classroom.beforeWindow');
  if (reason === 'AFTER_WINDOW') return t('classroom.afterWindow');

  return t('classroom.failed');
}
