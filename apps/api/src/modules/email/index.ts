// Public surface of the email/newsletter module.
export { EmailModule } from "./email.module";
export { type EmailMessage, type EmailPort } from "./email.port";
export { SmtpEmailClient, createEmailFromEnv, type SmtpConfig } from "./smtp";
export { renderConfirmEmail, renderNewsletter } from "./render";
export {
  nextSubscriberStatus,
  InvalidOptinTransitionError,
  type OptinEvent,
} from "./optin-state";
export {
  subscribe,
  confirm,
  unsubscribe,
  InvalidConfirmTokenError,
  type SubscribeInput,
  type SubscribeResult,
} from "./optin";
export {
  segmentForTheme,
  sendNewsletterToSegment,
  type SendNewsletterInput,
} from "./newsletter";
export { makeEmailDraftSink } from "./email-draft-sink";
