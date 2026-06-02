/** Nest DI tokens for the shared runtime adapters (provided by InfraModule). */
export const DB = Symbol("DB");
export const STORAGE = Symbol("STORAGE");
export const LLM = Symbol("LLM");
export const EMAIL = Symbol("EMAIL");
export const PAYMENT = Symbol("PAYMENT");
export const NOTIFICATION = Symbol("NOTIFICATION");
/**
 * The `email_draft` gate sink (Slice S3). Provided by InfraModule (the composition
 * root, which may import `modules/email`) and injected into the UNIFIED
 * `/agent-proposals` queue controller in `modules/content`, so that controller can
 * approve an `email_draft` WITHOUT `modules/content` importing `modules/email`
 * (the sink interface is owned by content; the implementation is supplied here).
 * The per-agent `/email` gate builds an equivalent sink inline from the same deps.
 */
export const EMAIL_DRAFT_SINK = Symbol("EMAIL_DRAFT_SINK");
