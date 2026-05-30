// Integration Gateway (Fase 2): OAuth-backed, rate-limited channel connectors.
export { TokenBucket, type TokenBucketOptions } from "./token-bucket";
export { sealSecret, openSecret } from "./crypto";
export {
  OAuthSession,
  InMemoryCredentialStore,
  createHttpTokenEndpoint,
  isTokenExpired,
  type OAuthToken,
  type TokenEndpoint,
  type CredentialStore,
} from "./oauth";
export { DbCredentialStore, createCredentialStore } from "./credentials.repo";
export {
  ConnectorError,
  AuthError,
  RateLimitedError,
  type Connector,
} from "./connector";
export {
  PinterestConnector,
  type PinterestConfig,
  type PinterestDeps,
  type PublishedPin,
} from "./pinterest";
