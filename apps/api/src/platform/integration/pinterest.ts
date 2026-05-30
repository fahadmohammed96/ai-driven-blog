import type { PinterestPin } from "@blogs/contracts";
import { TokenBucket } from "./token-bucket";
import { OAuthSession } from "./oauth";
import { AuthError, ConnectorError, RateLimitedError, type Connector } from "./connector";

export interface PinterestConfig {
  /** Base URL of the channel API (prod: https://api.pinterest.com/v5). */
  apiBaseUrl: string;
  boardId: string;
}

export interface PinterestDeps {
  session: OAuthSession;
  bucket: TokenBucket;
  fetch?: typeof fetch;
}

export interface PublishedPin {
  id: string;
}

/** The create-pin request body, per the channel contract (pinterest.openapi.json). */
function pinBody(pin: PinterestPin, boardId: string): Record<string, unknown> {
  return {
    board_id: boardId,
    title: pin.title,
    description: pin.description,
    media_source: { source_type: "image_id", media_id: pin.imageAssetId },
    ...(pin.link ? { link: pin.link } : {}),
  };
}

/**
 * Pinterest connector: publishes a pin through the Integration Gateway with
 * OAuth (Bearer + refresh on expiry/401) and a client-side rate limiter.
 */
export class PinterestConnector implements Connector {
  readonly name = "pinterest";

  constructor(
    private readonly deps: PinterestDeps,
    private readonly cfg: PinterestConfig,
  ) {}

  async publishPin(pin: PinterestPin): Promise<PublishedPin> {
    if (!this.deps.bucket.tryRemove()) throw new RateLimitedError("pinterest client rate limit exceeded");
    const body = pinBody(pin, this.cfg.boardId);

    let res = await this.post(body, await this.deps.session.accessToken());
    if (res.status === 401) {
      // Token rejected though not clock-expired: refresh once and retry.
      res = await this.post(body, await this.deps.session.forceRefresh());
    }
    if (res.status === 429) throw new RateLimitedError("pinterest responded 429");
    if (res.status === 401) throw new AuthError("pinterest rejected credentials");
    if (res.status !== 201) throw new ConnectorError(`pinterest create pin failed: ${res.status}`);

    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }

  private post(body: unknown, accessToken: string): Promise<Response> {
    const fetchImpl = this.deps.fetch ?? fetch;
    return fetchImpl(`${this.cfg.apiBaseUrl}/pins`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
  }
}
