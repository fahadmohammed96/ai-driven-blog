// Public surface of the crm module.
export { CrmModule } from "./crm.module";
export type {
  NotificationPort,
  ClientNotification,
  NotificationResult,
  NotificationKind,
} from "./notification.port";
export { StubNotificationClient, createNotificationFromEnv } from "./notification.stub";
export {
  nextLeadStatus,
  InvalidLeadTransitionError,
  type LeadEvent,
} from "./lead-state";
export {
  renderProposalSystemPrompt,
  buildProposalPrompt,
  draftProposal,
  type DraftProposalDeps,
  type DraftProposalInput,
} from "./proposal";
export {
  insertLead,
  getLead,
  getLeadByPortalToken,
  listLeads,
  updateLead,
  type LeadRow,
  type NewLead,
} from "./crm.repo";
export {
  createLead,
  draftLeadProposal,
  approveAndSend,
  rejectProposal,
  payLeadDeposit,
  deliverItinerary,
  LeadNotFoundError,
  LeadDepositNotSetError,
  LeadDepositFailedError,
  type CrmDeps,
  type CreateLeadInput,
  type DraftLeadInput,
} from "./crm.service";
