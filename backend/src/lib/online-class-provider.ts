import {
  EncodedFileOutput,
  EncodedFileType,
  EgressStatus,
  S3Upload,
  TrackSource,
} from "@livekit/protocol";
import { AccessToken, EgressClient, WebhookReceiver } from "livekit-server-sdk";

import type {
  ParticipantGrants,
} from "../policies/online-class.js";
import type { AppConfig } from "./config.js";

/**
 * **The media provider, behind the narrowest door that works** (R98.2).
 *
 * ## Why an interface at all, when there is exactly one implementation
 *
 * Not to make swapping providers cheap — `online-class-provider.md` is honest
 * that a migration is real work. It is so that **the reach of the decision is
 * visible**: this file is the only one in the backend that imports a LiveKit
 * symbol, and a CI guard says so. Without the seam, `AccessToken` and
 * `TrackSource` would appear in a service, then in a controller, then in a test
 * fixture, and R97.9's *"the domain must survive replacing what is written
 * here"* would become a sentence rather than a property.
 *
 * ## Why it has ONE method
 *
 * Everything else the platform might have asked a provider for turned out not
 * to be the provider's to answer:
 *
 * * **create the room** — LiveKit opens a room when the first authorised
 *   participant joins and closes it when the last one leaves, so there is
 *   nothing to create, nothing to reconcile and nothing to store (R98.17,
 *   R98.18). The name is derived (`roomNameForSession`), which is what makes a
 *   page refresh cost nothing.
 * * **who is in the room** — a media platform's participant list is not
 *   attendance (§4.7) and must never become an authorization input. Asking
 *   would create exactly the inverted dependency this section forbids.
 * * **recording** — R99 adds it, and it is still the platform that decides:
 *   `startRecording` is called only after `online-class.service` has checked
 *   R91 authority, and the provider is told what to record and where to put it.
 *   It is never asked whether it thinks recording is allowed.
 *
 * A method added "for later" is a capability nobody has reviewed, so the
 * interface stays at what the platform actually needs.
 */

export interface JoinCredentialRequest {
  /** The derived room name (`policies/online-class.ts`). Never a stored value. */
  room: string;
  /** The platform's own person identity — a `User.id`, and for a guardian
   *  acting for a child, the **child's** (R98.11). */
  identity: string;
  /** Presentation only. The provider shows it; nothing is decided from it. */
  displayName: string;
  grants: ParticipantGrants;
  /** Seconds, bounded by `tokenSecondsFor`. There are no timeless tokens. */
  ttlSeconds: number;
}

export interface JoinCredentials {
  /** The signalling URL the browser connects to. Not a secret. */
  url: string;
  /** A short-lived participant token. **The API key and secret never leave this
   *  process** — this is derived from them and grants only what it names. */
  token: string;
  expiresAt: Date;
}

/**
 * **What to record, in the platform's own words** (R99.7).
 *
 * `media` is the occurrence's own `online_media_mode`, so the artefact follows
 * the class rather than a provider default: صوت فقط records audio, صوت وصورة
 * records video with audio and is **never silently downgraded**.
 */
export interface RecordingRequest {
  room: string;
  media: "audio_video" | "audio_only";
  /**
   * The object key the platform chose. **The BUCKET is not the platform's to
   * choose** — it is where this provider was configured to write, so the
   * adapter supplies it and reports it back. That keeps a deployment detail out
   * of the domain service while still letting the row record exactly where the
   * object landed (R99.13).
   */
  key: string;
}

export interface RecordingHandle {
  /** The provider's own job id. Integration state, and the idempotency key for
   *  every callback about it (R99.15). */
  providerEgressId: string;
  /** What the provider will produce, so the platform can verify it later. */
  mimeType: string;
  /** Where it will land — recorded on the row so ingestion (C2) never has to
   *  ask the provider where it put anything. */
  outputBucket: string;
  outputKey: string;
}

/** A provider's report about one recording, translated into platform terms. */
export interface RecordingReport {
  providerEgressId: string;
  /** The platform's own vocabulary — never the provider's enum. */
  state: "recording" | "processing" | "completed" | "failed" | "aborted";
  outputKey?: string;
  sizeBytes?: number;
  durationMs?: number;
  failureReason?: string;
}

export interface OnlineClassProvider {
  issueJoinCredentials(
    request: JoinCredentialRequest,
  ): Promise<JoinCredentials>;

  /** **Only ever called after the platform has authorised it** (R99.3). */
  startRecording(request: RecordingRequest): Promise<RecordingHandle>;

  /** Idempotent by nature: stopping an already-stopped job is not an error the
   *  caller should have to distinguish. */
  stopRecording(providerEgressId: string): Promise<void>;

  /**
   * **Verifies a callback and translates it — or refuses it** (R99.15).
   *
   * Returns `null` when the signature does not verify or the payload is not an
   * egress event, so an arbitrary external request **cannot manufacture
   * anything**. The raw body is required: a parsed-and-reserialised body no
   * longer matches the signature.
   */
  verifyCallback(rawBody: string, authHeader: string | undefined): Promise<RecordingReport | null>;
}

const SOURCES: Record<ParticipantGrants["canPublishSources"][number], TrackSource> =
  {
    microphone: TrackSource.MICROPHONE,
    camera: TrackSource.CAMERA,
    screen_share: TrackSource.SCREEN_SHARE,
  };

/**
 * The LiveKit implementation — a JWT signed with the API secret, carrying
 * exactly the grants the platform decided and nothing more.
 *
 * **`roomCreate` is deliberately absent.** `roomJoin` with a room name is enough
 * for LiveKit to open the room on first join; granting room creation would let a
 * token do something outside the one occurrence it was minted for. Same for
 * `roomList`, `roomRecord` and `ingressAdmin` — none is set, so none is held.
 */
export class LiveKitOnlineClassProvider implements OnlineClassProvider {
  private readonly egress: EgressClient;
  private readonly webhooks: WebhookReceiver;

  constructor(
    /** What the BROWSER connects to. Handed out; never called from here. */
    private readonly url: string,
    /** What the SERVER calls. In production the same host; in a split-horizon
     *  deployment (every local one) an internal address instead. */
    apiUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    /**
     * Where the recording facility leaves its output — the **staging** area,
     * not the content bucket (R99.13). It is passed in rather than read here so
     * this file keeps knowing only about the provider: what the platform does
     * with the object afterwards is the ingestion boundary's business.
     */
    private readonly staging: StagingTarget,
  ) {
    // The server API speaks HTTP even when participants speak WebSocket.
    const httpUrl = apiUrl.replace(/^ws/, "http");
    this.egress = new EgressClient(httpUrl, apiKey, apiSecret);
    this.webhooks = new WebhookReceiver(apiKey, apiSecret);
  }

  async issueJoinCredentials(
    request: JoinCredentialRequest,
  ): Promise<JoinCredentials> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: request.identity,
      name: request.displayName,
      ttl: request.ttlSeconds,
    });

    token.addGrant({
      roomJoin: true,
      room: request.room,
      canPublish: request.grants.canPublish,
      canSubscribe: request.grants.canSubscribe,
      canPublishData: request.grants.canPublishData,
      roomAdmin: request.grants.roomAdmin,
      // Supersedes `canPublish` for the sources named — which is what makes
      // «صوت فقط» a property of the token rather than of the interface.
      canPublishSources: request.grants.canPublishSources.map((s) => SOURCES[s]),
    });

    return {
      url: this.url,
      token: await token.toJwt(),
      expiresAt: new Date(Date.now() + request.ttlSeconds * 1000),
    };
  }

  /**
   * **A room-composite recording: the class as it was actually delivered.**
   *
   * Composite rather than per-participant, because what the association wants
   * is *the lesson* — one artefact a beneficiary can play — not a folder of
   * per-speaker tracks somebody would have to reassemble.
   *
   * `audioOnly` is set from the occurrence's own media mode, so a صوت فقط class
   * produces an OGG audio file and asks the recorder for no video at all, and a
   * صوت وصورة class produces MP4 with audio (R99.7). Both are TD-9 types.
   */
  async startRecording(request: RecordingRequest): Promise<RecordingHandle> {
    const audioOnly = request.media === "audio_only";
    const fileType = audioOnly ? EncodedFileType.OGG : EncodedFileType.MP4;

    const output = new EncodedFileOutput({
      fileType,
      filepath: request.key,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: this.staging.accessKey,
          secret: this.staging.secretKey,
          bucket: this.staging.bucket,
          region: this.staging.region,
          endpoint: this.staging.endpoint,
          // MinIO addresses buckets by path, not by DNS subdomain.
          forcePathStyle: true,
        }),
      },
    });

    const info = await this.egress.startRoomCompositeEgress(request.room, output, {
      audioOnly,
      ...(audioOnly ? {} : { layout: "grid" }),
    });

    return {
      providerEgressId: info.egressId,
      mimeType: audioOnly ? "audio/ogg" : "video/mp4",
      outputBucket: this.staging.bucket,
      outputKey: request.key,
    };
  }

  async stopRecording(providerEgressId: string): Promise<void> {
    await this.egress.stopEgress(providerEgressId);
  }

  /**
   * **The one place a provider's own vocabulary is translated**, and the one
   * place a callback is trusted at all.
   *
   * `receive` verifies the signature against the API secret; anything that does
   * not verify throws, and the throw becomes `null` rather than an error the
   * caller might mistake for a transient failure and retry. A verified event
   * that is not about an egress is also `null`: there is nothing to say.
   */
  async verifyCallback(
    rawBody: string,
    authHeader: string | undefined,
  ): Promise<RecordingReport | null> {
    let event;
    try {
      event = await this.webhooks.receive(rawBody, authHeader);
    } catch {
      // An unsigned, mis-signed or replayed-beyond-tolerance request. It
      // manufactures nothing (R99.15).
      return null;
    }

    const info = event.egressInfo;
    if (!info || !info.egressId) return null;

    const file = info.fileResults?.[0];
    const state = TRANSLATE[info.status];
    if (!state) return null;

    return {
      providerEgressId: info.egressId,
      state,
      ...(file?.filename ? { outputKey: file.filename } : {}),
      ...(file?.size ? { sizeBytes: Number(file.size) } : {}),
      ...(file?.duration ? { durationMs: Number(file.duration) / 1_000_000 } : {}),
      ...(info.error ? { failureReason: info.error } : {}),
    };
  }
}

/** The provider's status enum, translated into the platform's own states once
 *  and nowhere else — `RecordingStatus` never learns a vendor's spelling. */
const TRANSLATE: Partial<Record<EgressStatus, RecordingReport["state"]>> = {
  [EgressStatus.EGRESS_STARTING]: "recording",
  [EgressStatus.EGRESS_ACTIVE]: "recording",
  [EgressStatus.EGRESS_ENDING]: "processing",
  [EgressStatus.EGRESS_COMPLETE]: "completed",
  [EgressStatus.EGRESS_FAILED]: "failed",
  [EgressStatus.EGRESS_ABORTED]: "aborted",
};

/** The credentials the recording facility needs to write its staging object.
 *  Held here, never handed to a client, never stored on a domain row. */
export interface StagingTarget {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/**
 * **`null` when the platform is not configured for online classes** — which is
 * a complete, valid deployment, not a broken one (TD-13).
 *
 * `loadConfig` has already refused a *half*-configured one at boot, so reaching
 * here with some settings and not others is impossible; the caller therefore has
 * only two cases to handle, and the one it must handle is honest: `503
 * SERVICE_UNAVAILABLE` naming the settings an operator has to set.
 */
export function createOnlineClassProvider(
  config: AppConfig,
): OnlineClassProvider | null {
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    return null;
  }
  return new LiveKitOnlineClassProvider(
    config.LIVEKIT_URL,
    // Defaults to the client URL, which is correct wherever the browser and the
    // API reach the provider at the same address — production. Development
    // overrides it, because there they do not.
    config.LIVEKIT_API_URL ?? config.LIVEKIT_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    {
      /**
       * **The staging target reuses the platform's own object store, and that
       * is not the same as putting a recording in the library.**
       *
       * The recorder writes to a bucket the platform owns but does not serve —
       * `RECORDING_STAGING_BUCKET`, neither the `public` nor the `private`
       * content bucket. Ingestion (C2) then verifies the object and writes it
       * into the content lifecycle under a TD-9 key. Keeping the two apart is
       * what makes R99.13 true: what the provider produced is never what the
       * library points at.
       *
       * The recorder addresses MinIO on the internal network, so it needs
       * `MINIO_ENDPOINT` rather than the public `/storage` origin — nothing
       * here is ever handed to a browser.
       */
      endpoint: config.MINIO_ENDPOINT,
      region: "us-east-1",
      bucket: config.RECORDING_STAGING_BUCKET,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
    },
  );
}
