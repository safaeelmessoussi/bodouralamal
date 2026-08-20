import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionState,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import {
  ConnectionState,
  MediaDeviceFailure,
  Track,
  type Participant,
} from 'livekit-client';
import { useRef, useState, type ReactNode } from 'react';

import type { JoinCredentials } from '../../adapters/online-class.js';
import { t } from '../../i18n/index.js';
import { Button } from '../ui/button.js';
import { Feedback } from '../ui/feedback.js';

/**
 * **ONE classroom, for every portal** (R98.20, rule C).
 *
 * There is no Student classroom, no Teacher classroom and no Admin classroom.
 * The surface adapts to two facts that arrive **on the token**, both decided by
 * the server:
 *
 * * `media_mode` — whether this class has video at all;
 * * `role` — whether the person holds teaching authority, which is the only
 *   thing that differs between them.
 *
 * A second component per audience is how two of them drift, and the one that
 * drifts is the one nobody is testing. **Nothing here decides authorization**
 * (rule O): the token already carries exactly what its holder may publish, so a
 * modified client can hide a control but cannot acquire a capability.
 *
 * ## Inside بذور الأمل, not away from it
 *
 * The class runs on this platform's own page, in Arabic and RTL, with the
 * platform's own vocabulary. **No vendor is named anywhere a مستفيدة, a parent
 * or a مؤطِّرة can read** (rule M, R97.9) — she enters «حصة», not a product.
 *
 * ## No recording control, deliberately
 *
 * The provider's own component library offers recording affordances; none is
 * mounted, and the token carries no `roomRecord` grant, so none could work.
 * Recording is a later revision with a consent gate (BR-2) attached, and a
 * button that starts an unconsented recording is precisely the thing that must
 * not exist first.
 */
export function OnlineClassroom({
  credentials,
  onLeave,
}: {
  credentials: JoinCredentials;
  onLeave: () => void;
}): ReactNode {
  const [deviceIssue, setDeviceIssue] = useState<string | null>(null);
  const audioOnly = credentials.media_mode === 'audio_only';
  /**
   * **«انتهت الحصة» must mean the class ended, not that it never began.**
   *
   * `LiveKitRoom` reports a disconnect during its own negotiation as well as
   * after a real one, so treating every `onDisconnected` as *she left* showed
   * the goodbye screen a fraction of a second after she pressed the button —
   * with the room connecting perfectly behind it. Leaving is only leaving once
   * she has actually been inside.
   */
  const wasConnected = useRef(false);

  return (
    <LiveKitRoom
      className="classroom"
      serverUrl={credentials.url}
      token={credentials.token}
      connect
      /**
       * **`video` is false for an audio-only class, and that is the whole
       * mechanism** (R98.22).
       *
       * Hiding a video grid with CSS while the component still calls
       * `getUserMedia({ video: true })` would put a camera-permission prompt in
       * front of a مستفيدة for a class that has no video — and on many phones
       * would light the camera indicator. The capture is never requested, and
       * the token independently forbids publishing anything but a microphone,
       * so «صوت فقط» is true at the device, at the client and at the server.
       */
      video={!audioOnly}
      audio
      onConnected={() => {
        wasConnected.current = true;
      }}
      onDisconnected={() => {
        if (wasConnected.current) onLeave();
      }}
      // Never the SDK's own exception text (R98.15) — a sentence she can act on.
      onError={() => setDeviceIssue(t('classroom.failed'))}
      onMediaDeviceFailure={(failure, kind) =>
        setDeviceIssue(deviceMessage(failure, kind))
      }
    >
      {/* Without this nobody is heard: it is what attaches remote audio tracks
          to the page. Needed in BOTH modes — an audio-only class is entirely
          this element. */}
      <RoomAudioRenderer />
      <ClassroomStage
        audioOnly={audioOnly}
        deviceIssue={deviceIssue}
        onLeave={onLeave}
      />
    </LiveKitRoom>
  );
}

/**
 * The room's inside. A separate component because every hook below needs the
 * room context `LiveKitRoom` establishes — they cannot run in the component
 * that creates it.
 */
function ClassroomStage({
  audioOnly,
  deviceIssue,
  onLeave,
}: {
  audioOnly: boolean;
  deviceIssue: string | null;
  onLeave: () => void;
}): ReactNode {
  const state = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } =
    useLocalParticipant();

  return (
    /**
     * **The connection state is in the DOM, not only in a sentence.**
     *
     * A harness reading the rendered text cannot tell *«the room is open and
     * empty»* from *«the connection never completed»* — and that ambiguity is
     * exactly what let three tabs report success while only one was actually
     * connected. `data-connection` is the state itself, so a check can assert
     * the real thing instead of a proxy for it.
     */
    <div className="classroom__stage" data-connection={state}>
      {/**
       * **Connection state is said, not implied by an empty room** (R98.21).
       *
       * «جارٍ الدخول» and «انقطع الاتصال مؤقتًا» are different facts and a
       * reader must be able to tell them apart — a silent grid of nobody looks
       * identical to a class she is the first to arrive at.
       */}
      {state === ConnectionState.Connecting ? (
        <p className="classroom__state">{t('classroom.connecting')}</p>
      ) : null}
      {state === ConnectionState.Reconnecting ? (
        <p className="classroom__state classroom__state--warn" role="status">
          {t('classroom.reconnecting')}
        </p>
      ) : null}
      {state === ConnectionState.Disconnected ? (
        <p className="classroom__state" role="status">
          {t('classroom.disconnected')}
        </p>
      ) : null}

      {/* The shared action-message component (rule AH), never a hand-written
          `<p role="status">` — a device failure is an outcome of something the
          reader just did, so it belongs beside the controls that did it. */}
      {deviceIssue ? <Feedback tone="warn">{deviceIssue}</Feedback> : null}

      {audioOnly ? <AudioStage /> : <VideoStage />}

      <div className="classroom__controls">
        {/* The shared Button, never hand-written markup (rule C) — a
            classroom is not exempt from the platform's one button. */}
        <Button
          aria-pressed={isMicrophoneEnabled}
          onClick={() => {
            void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
          }}
        >
          {isMicrophoneEnabled ? t('classroom.micOff') : t('classroom.micOn')}
        </Button>

        {/* Absent — not disabled — in an audio-only class: a control that can
            never do anything is worse than none (R97's own §13 rule). */}
        {audioOnly ? null : (
          <Button
            aria-pressed={isCameraEnabled}
            onClick={() => {
              void localParticipant.setCameraEnabled(!isCameraEnabled);
            }}
          >
            {isCameraEnabled ? t('classroom.cameraOff') : t('classroom.cameraOn')}
          </Button>
        )}

        <Button variant="danger" onClick={onLeave}>
          {t('classroom.leave')}
        </Button>
      </div>
    </div>
  );
}

/** صوت وصورة — the participants' own tiles, from the provider's primitives
 *  rather than a hand-rolled video grid. */
function VideoStage(): ReactNode {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <GridLayout tracks={tracks} className="classroom__grid">
      <ParticipantTile />
    </GridLayout>
  );
}

/**
 * صوت فقط — **a surface designed for listening**, not a video layout with the
 * pictures removed (R98.22).
 *
 * An empty video grid says *«nobody has their camera on»*, which is a false
 * statement about a class that has no cameras at all. What a reader needs
 * instead is who is present and who is speaking right now, which is exactly
 * what a class on the telephone would give her.
 */
function AudioStage(): ReactNode {
  const participants = useParticipants();

  return (
    <section className="classroom__audio" aria-label={t('classroom.participants')}>
      <p className="classroom__notice">{t('classroom.audioOnlyNotice')}</p>
      <ul className="classroom__participants">
        {participants.map((participant) => (
          <AudioParticipantRow key={participant.sid} participant={participant} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One row. **A component per participant because `useIsSpeaking` is a hook** —
 * calling it inside a loop in the parent is not allowed, and reading
 * `participant.isSpeaking` directly would render once and then never update.
 */
function AudioParticipantRow({
  participant,
}: {
  participant: Participant;
}): ReactNode {
  const speaking = useIsSpeaking(participant);
  return (
    <li className={`classroom__participant${speaking ? ' is-speaking' : ''}`}>
      <span className="classroom__participant-name">
        {participant.name || participant.identity}
      </span>
      {/* A WORD, never a colour alone (rule AV) — «تتحدّث الآن» is readable by
          a screen reader and by someone who cannot see the highlight. */}
      <span className="classroom__participant-state">
        {speaking ? t('classroom.speaking') : t('classroom.listening')}
      </span>
    </li>
  );
}

/**
 * **A device failure in the platform's words** (R98.23).
 *
 * A raw `NotAllowedError` or `OverconstrainedError` tells a مستفيدة nothing and
 * tells her nothing about what to do next. Each case names what happened *and*
 * the action that fixes it.
 *
 * **A camera failure is not fatal to an `audio_video` class.** The room stays
 * connected and the microphone keeps working, so the message says she may
 * continue by voice rather than ending the class over a device she may not
 * have.
 */
export function deviceMessage(
  failure: MediaDeviceFailure | undefined,
  kind: MediaDeviceKind | undefined,
): string {
  const camera = kind === 'videoinput';
  if (failure === MediaDeviceFailure.PermissionDenied) {
    return t(camera ? 'classroom.cameraDenied' : 'classroom.micDenied');
  }
  if (
    failure === MediaDeviceFailure.NotFound ||
    failure === MediaDeviceFailure.DeviceInUse
  ) {
    return t(camera ? 'classroom.cameraUnavailable' : 'classroom.micUnavailable');
  }
  // An unrecognised failure still gets a sentence in Arabic rather than an
  // exception string — a message nobody can act on is better than one nobody
  // can read.
  return t(camera ? 'classroom.cameraUnavailable' : 'classroom.micUnavailable');
}
