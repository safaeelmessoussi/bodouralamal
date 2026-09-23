import { RECORDER_OPTIONS } from './recorder.js';
import {
  type PersistedSession,
  type Platform,
  type RecordingStore,
  RecordingSession,
} from './recording-session.js';

/**
 * The browser behind `RecordingSession` (SRS Revision 172 §4): the microphone
 * and `MediaRecorder`, the Wake Lock, and IndexedDB as the phone's own store
 * for the audio while it is being made.
 *
 * **Nothing here leaves the device.** The chunks are written to this origin's
 * IndexedDB so a dead page can be recovered from; they are cleared the moment
 * the recording is saved to the platform or discarded. The browser's storage
 * can be unavailable (private mode, cleared site data): every call is guarded,
 * and a recorder without storage still records — it merely cannot survive a
 * reload, which is what the page said before this revision anyway.
 */
const DB_NAME = 'bodour-recorder';
const DB_VERSION = 1;
const SESSION_STORE = 'session';
const CHUNK_STORE = 'chunks';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused'));
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('request failed'));
  });
}

export function indexedDbStore(): RecordingStore {
  return {
    async saveSession(session: PersistedSession): Promise<void> {
      const db = await openDatabase();
      try {
        const tx = db.transaction(SESSION_STORE, 'readwrite');
        tx.objectStore(SESSION_STORE).put(session, 'current');
        await done(tx);
      } finally {
        db.close();
      }
    },
    async appendChunk(chunk: Blob): Promise<void> {
      const db = await openDatabase();
      try {
        const tx = db.transaction(CHUNK_STORE, 'readwrite');
        tx.objectStore(CHUNK_STORE).add(chunk);
        await done(tx);
      } finally {
        db.close();
      }
    },
    async load(): Promise<{ session: PersistedSession; chunks: Blob[] } | null> {
      const db = await openDatabase();
      try {
        const tx = db.transaction([SESSION_STORE, CHUNK_STORE], 'readonly');
        const session = (await result(tx.objectStore(SESSION_STORE).get('current'))) as
          | PersistedSession
          | undefined;
        if (!session) return null;
        // In insertion order — the keys are auto-incremented.
        const chunks = (await result(tx.objectStore(CHUNK_STORE).getAll())) as Blob[];
        return { session, chunks };
      } finally {
        db.close();
      }
    },
    async clear(): Promise<void> {
      const db = await openDatabase();
      try {
        const tx = db.transaction([SESSION_STORE, CHUNK_STORE], 'readwrite');
        tx.objectStore(SESSION_STORE).clear();
        tx.objectStore(CHUNK_STORE).clear();
        await done(tx);
      } finally {
        db.close();
      }
    },
  };
}

export function browserPlatform(): Platform {
  return {
    async openRecorder(container) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: RECORDER_OPTIONS.channelCount },
      });
      const recorder = new MediaRecorder(stream, {
        mimeType: container,
        audioBitsPerSecond: RECORDER_OPTIONS.audioBitsPerSecond,
      });
      const handle = {
        start: (timeslice: number) => recorder.start(timeslice),
        pause: () => recorder.pause(),
        resume: () => recorder.resume(),
        stop: () => recorder.stop(),
        ondataavailable: null as ((chunk: Blob) => void) | null,
        onstop: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      recorder.ondataavailable = (event) => handle.ondataavailable?.(event.data);
      recorder.onstop = () => handle.onstop?.();
      recorder.onerror = () => handle.onerror?.();
      return {
        recorder: handle,
        /** A live track keeps the browser's recording indicator on, which reads
         *  as *still listening* long after it has stopped. */
        release: () => stream.getTracks().forEach((track) => track.stop()),
        onCaptureGap: (listener) => {
          // The browser mutes the track when it suspends capture (a locked
          // iPhone, a tab put to sleep): the one signal that audio was lost.
          for (const track of stream.getAudioTracks()) {
            track.addEventListener('mute', listener);
            track.addEventListener('ended', listener);
          }
        },
      };
    },
    store: indexedDbStore(),
    requestWakeLock:
      typeof navigator !== 'undefined' && 'wakeLock' in navigator
        ? async () => {
            const sentinel = await navigator.wakeLock.request('screen');
            return () => void sentinel.release().catch(() => undefined);
          }
        : undefined,
    now: () => Date.now(),
  };
}

let instance: RecordingSession | null = null;

/** The application's one recording session (see `RecordingSession`). */
export function recordingSession(): RecordingSession {
  instance ??= new RecordingSession(browserPlatform());
  return instance;
}
