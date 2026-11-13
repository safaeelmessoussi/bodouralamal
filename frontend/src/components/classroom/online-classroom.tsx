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
  DisconnectReason,
  MediaDeviceFailure,
  Track,
  type Participant,
} from 'livekit-client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { endClass, MODERATORS, type JoinCredentials } from '../../adapters/online-class.js';
import { t } from '../../i18n/index.js';
import { mediaLabel } from '../scheduling/delivery.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Feedback } from '../ui/feedback.js';
import { Icon, type IconName } from '../ui/icon.js';
import { RecordingPanel } from './recording.js';

/**
 * **ONE classroom, for every portal** (R98.20, rule C).
 *
 * There is no Student classroom, no Teacher classroom and no Admin classroom.
 * The surface adapts to two facts that arrive **on the token**, both decided by
 * the server:
 *
 * * `media_mode` — whether this class has video at all;
 * * `role` — whether the person moderates the class (the مؤطِّرة, her
 *   assistant or an administrator, R267), which is the only thing that differs
 *   between them («إنهاء الحصة للجميع», recording and sharing the screen).
 *
 * **Nothing here decides authorization** (rule O): the token already carries
 * exactly what its holder may publish, so a modified client can hide a control
 * but cannot acquire a capability.
 *
 * ## Inside بذور الأمل, not away from it (R266)
 *
 * The Owner, 2026-11-12: the class page «should look part of the platform,
 * beautiful, elegant, modern and easy to use, for all users». So the room is a
 * full-height stage in the platform's own colours: a header naming the class,
 * its time, «مباشر» and who is present; the media in the middle; one bar of
 * round controls at the bottom, each with a word under it. **No vendor is named
 * anywhere** (rule M, R97.9).
 */
/** Stable across renders: a new object each time would reconnect the room. */
const NO_THIRD_PARTY_ICE = { rtcConfig: { iceServers: [] } };


export function OnlineClassroom({
  credentials,
  accessToken,
  onLeave,
  onEnded,
}: {
  credentials: JoinCredentials;
  /** R99 — recording is a Bodour operation, authorised by Bodour's own token
   *  and never by the provider's participant token. */
  accessToken: string;
  onLeave: () => void;
  /** R266 — the class was ended for everyone (by this reader or another). */
  onEnded: () => void;
}): ReactNode {
  const [deviceIssue, setDeviceIssue] = useState<string | null>(null);
  const audioOnly = credentials.media_mode === 'audio_only';
  /**
   * **«انتهت الحصة» must mean the class ended, not that it never began.**
   *
   * `LiveKitRoom` reports a disconnect during its own negotiation as well as
   * after a real one, so leaving is only leaving once she has actually been
   * inside.
   */
  const wasConnected = useRef(false);

  return (
    <LiveKitRoom
      className="classroom"
      serverUrl={credentials.url}
      token={credentials.token}
      connect
      /**
       * **No STUN server — ours or anybody's** (SRS Revision 164). An explicit
       * list — even an empty one — replaces the server's default third-party
       * list, so no beneficiary's browser tells a third party its address.
       */
      connectOptions={NO_THIRD_PARTY_ICE}
      /**
       * **`video` is false for an audio-only class, and that is the whole
       * mechanism** (R98.22): the camera is never requested, so no permission
       * prompt and no camera light for a class that has no video.
       */
      video={!audioOnly}
      audio
      onConnected={() => {
        wasConnected.current = true;
      }}
      onDisconnected={(reason) => {
        if (!wasConnected.current) return;
        // R266 — the room was closed because the class was ended for everyone.
        if (reason === DisconnectReason.ROOM_DELETED) onEnded();
        else onLeave();
      }}
      // Never the SDK's own exception text (R98.15) — a sentence she can act on.
      onError={() => setDeviceIssue(t('classroom.failed'))}
      onMediaDeviceFailure={(failure, kind) =>
        setDeviceIssue(deviceMessage(failure, kind))
      }
    >
      {/* Without this nobody is heard: it attaches remote audio to the page. */}
      <RoomAudioRenderer />
      <ClassroomStage
        credentials={credentials}
        accessToken={accessToken}
        audioOnly={audioOnly}
        deviceIssue={deviceIssue}
        onLeave={onLeave}
        onEnded={onEnded}
        recording={
          /**
           * **R99 — inside the room, so «جاري التسجيل» comes from the room.**
           * Rendered for everybody; the controls inside it are shown only to
           * the role the server named, and the server refuses the rest.
           */
          <RecordingPanel
            sessionId={credentials.session_id}
            role={credentials.role}
            accessToken={accessToken}
          />
        }
      />
    </LiveKitRoom>
  );
}

/**
 * The room's inside. A separate component because every hook below needs the
 * room context `LiveKitRoom` establishes.
 */
function ClassroomStage({
  credentials,
  accessToken,
  audioOnly,
  deviceIssue,
  onLeave,
  onEnded,
  recording,
}: {
  credentials: JoinCredentials;
  accessToken: string;
  audioOnly: boolean;
  deviceIssue: string | null;
  onLeave: () => void;
  onEnded: () => void;
  recording: ReactNode;
}): ReactNode {
  const state = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const teaching = MODERATORS.includes(credentials.role);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endIssue, setEndIssue] = useState<string | null>(null);

  const times =
    credentials.start_time && credentials.end_time
      ? `${credentials.start_time} — ${credentials.end_time}`
      : null;
  const media = mediaLabel({ delivery_mode: 'online', online_media_mode: credentials.media_mode });

  async function endForEveryone(): Promise<void> {
    setEnding(true);
    setEndIssue(null);
    try {
      await endClass(credentials.session_id, accessToken);
      setConfirmingEnd(false);
      onEnded();
    } catch {
      setEndIssue(t('classroom.endFailed'));
      setEnding(false);
    }
  }

  return (
    /**
     * **The connection state is in the DOM, not only in a sentence** —
     * `data-connection` is the state itself, so a harness asserts the real
     * thing instead of a proxy for it.
     */
    <div className="classroom__stage" data-connection={state}>
      <header className="classroom__bar">
        <div className="classroom__heading">
          <p className="classroom__status">
            {state === ConnectionState.Connected ? (
              <span className="classroom__live">
                <span aria-hidden="true" className="classroom__live-dot" />
                {t('classroom.live')}
              </span>
            ) : null}
            {state === ConnectionState.Connected ? <Elapsed /> : null}
          </p>
          <h1 className="classroom__title">{credentials.title || t('classroom.title')}</h1>
          <p className="classroom__meta">
            {[
              (credentials.surah_names ?? []).map((name) => t('classroom.surah').replace('{name}', name)).join('، '),
              credentials.date_label,
              times,
              media,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <p className="classroom__count">
          <Icon name="users" size={18} />
          {t('classroom.participantsCount').replace('{n}', String(participants.length))}
        </p>
      </header>

      {/**
       * **Connection state is said, not implied by an empty room** (R98.21).
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

      {deviceIssue ? <Feedback tone="warn">{deviceIssue}</Feedback> : null}
      {endIssue ? <Feedback tone="warn">{endIssue}</Feedback> : null}

      {/* Above the media, where a persistent state belongs. */}
      {recording}

      <div className="classroom__media">
        {audioOnly ? <AudioStage participants={participants} /> : <VideoStage />}
      </div>

      <div className="classroom__controls" role="toolbar" aria-label={t('classroom.title')}>
        <ControlButton
          icon={isMicrophoneEnabled ? 'mic' : 'mic-off'}
          label={t('classroom.micShort')}
          action={isMicrophoneEnabled ? t('classroom.micOff') : t('classroom.micOn')}
          pressed={isMicrophoneEnabled}
          off={!isMicrophoneEnabled}
          onClick={() => {
            void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
          }}
        />

        {/* Absent — not disabled — in an audio-only class: a control that can
            never do anything is worse than none (R97's own §13 rule). */}
        {audioOnly ? null : (
          <ControlButton
            icon={isCameraEnabled ? 'camera' : 'camera-off'}
            label={t('classroom.cameraShort')}
            action={isCameraEnabled ? t('classroom.cameraOff') : t('classroom.cameraOn')}
            pressed={isCameraEnabled}
            off={!isCameraEnabled}
            onClick={() => {
              void localParticipant.setCameraEnabled(!isCameraEnabled);
            }}
          />
        )}

        {/* Sharing the screen — the مؤطِّرة showing the مطبوع. */}
        {audioOnly || !teaching ? null : (
          <ControlButton
            icon="screen"
            label={t('classroom.screenShort')}
            action={isScreenShareEnabled ? t('classroom.screenOff') : t('classroom.screenOn')}
            pressed={isScreenShareEnabled}
            onClick={() => {
              void localParticipant.setScreenShareEnabled(!isScreenShareEnabled).catch(() => undefined);
            }}
          />
        )}

        <ControlButton
          icon="leave"
          label={t('classroom.leaveShort')}
          action={t('classroom.leave')}
          tone="danger"
          onClick={onLeave}
        />

        {teaching ? (
          <ControlButton
            icon="stop"
            label={t('classroom.endShort')}
            action={t('classroom.endForAll')}
            tone="danger-strong"
            onClick={() => setConfirmingEnd(true)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmingEnd}
        title={t('classroom.endForAll')}
        body={t('classroom.endConfirmBody')}
        confirmLabel={t('classroom.endConfirm')}
        danger
        busy={ending}
        onConfirm={() => {
          void endForEveryone();
        }}
        onCancel={() => setConfirmingEnd(false)}
      />
    </div>
  );
}

/**
 * One round control with its word underneath. **The shared Button** (rule C):
 * the classroom is not exempt from the platform's one button; only its shape
 * differs. The visible word is short; the accessible name says the action.
 */
function ControlButton({
  icon,
  label,
  action,
  onClick,
  pressed,
  off = false,
  tone,
}: {
  icon: IconName;
  label: string;
  action: string;
  onClick: () => void;
  pressed?: boolean;
  off?: boolean;
  tone?: 'danger' | 'danger-strong';
}): ReactNode {
  const classes = [
    'classroom__control',
    off ? 'is-off' : '',
    tone ? `classroom__control--${tone}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Button
      variant="ghost"
      className={classes}
      aria-label={action}
      title={action}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
    >
      <span className="classroom__control-icon">
        <Icon name={icon} size={22} />
      </span>
      <span className="classroom__control-label" aria-hidden="true">
        {label}
      </span>
    </Button>
  );
}

/** «مدة الحضور» — minutes and seconds since this reader came in. */
function Elapsed(): ReactNode {
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  const text = hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
  return (
    <span className="classroom__elapsed" role="timer" title={t('classroom.elapsed')} dir="ltr">
      {text}
    </span>
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
 * pictures removed (R98.22): who is present, and who is speaking right now.
 * The مؤطِّرة first, then the reader, then everybody else by name.
 */
function AudioStage({ participants }: { participants: Participant[] }): ReactNode {
  const ordered = [...participants].sort((a, b) => rank(a) - rank(b));
  return (
    <section className="classroom__audio" aria-label={t('classroom.participants')}>
      <p className="classroom__notice">{t('classroom.audioOnlyNotice')}</p>
      <ul className="classroom__participants">
        {ordered.map((participant) => (
          <AudioParticipantRow key={participant.sid} participant={participant} />
        ))}
      </ul>
    </section>
  );
}

function isTeaching(participant: Participant): boolean {
  const role = participant.attributes['role'];
  return role === 'teacher' || role === 'assistant';
}

function rank(participant: Participant): number {
  if (isTeaching(participant)) return 0;
  if (participant.isLocal) return 1;
  return 2;
}

/** The first letter of each of the first two words — «صفاء العلوي» → «ص ع». */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join(' ');
}

/**
 * One participant card. **A component per participant because `useIsSpeaking`
 * is a hook** — reading `participant.isSpeaking` directly would render once and
 * then never update.
 */
function AudioParticipantRow({
  participant,
}: {
  participant: Participant;
}): ReactNode {
  const speaking = useIsSpeaking(participant);
  const name = participant.name || participant.identity;
  const muted = !participant.isMicrophoneEnabled;
  return (
    <li
      className={[
        'classroom__participant',
        speaking ? 'is-speaking' : '',
        isTeaching(participant) ? 'is-teacher' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="classroom__avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span className="classroom__participant-name">
        {name}
        {participant.isLocal ? <span className="classroom__you"> ({t('classroom.you')})</span> : null}
      </span>
      {isTeaching(participant) ? (
        <span className="classroom__badge">{t('classroom.teacherBadge')}</span>
      ) : null}
      {/* A WORD, never a colour alone (rule AV). */}
      <span className="classroom__participant-state">
        {muted ? <Icon name="mic-off" size={16} /> : null}
        {speaking
          ? t('classroom.speaking')
          : muted
            ? t('classroom.micMuted')
            : t('classroom.listening')}
      </span>
    </li>
  );
}

/**
 * **A device failure in the platform's words** (R98.23). Each case names what
 * happened *and* the action that fixes it. **A camera failure is not fatal to
 * an `audio_video` class**: the room stays connected and the microphone keeps
 * working.
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
  return t(camera ? 'classroom.cameraUnavailable' : 'classroom.micUnavailable');
}
