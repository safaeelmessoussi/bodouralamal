import { TrackSource } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

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
 * * **recording** — Section C, deliberately absent. No Egress client is
 *   constructed, imported, or configured here.
 *
 * A method added "for later" is a capability nobody has reviewed, so the
 * interface stays at what Section B actually needs.
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

export interface OnlineClassProvider {
  issueJoinCredentials(
    request: JoinCredentialRequest,
  ): Promise<JoinCredentials>;
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
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

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
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
  );
}
