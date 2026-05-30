/** Base error for any Integration Gateway connector failure. */
export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** The channel rejected our credentials (and a refresh did not help). */
export class AuthError extends ConnectorError {
  constructor(message = "connector authentication failed") {
    super(message);
    this.name = "AuthError";
  }
}

/** We are over the rate limit (client-side bucket, or the channel returned 429). */
export class RateLimitedError extends ConnectorError {
  constructor(message = "connector rate limit exceeded") {
    super(message);
    this.name = "RateLimitedError";
  }
}

/** Common shape of an Integration Gateway connector. */
export interface Connector {
  readonly name: string;
}
