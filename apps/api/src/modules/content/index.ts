// Public surface of the content module.
export { ContentModule } from "./content.module";
export { ContentService } from "./content.service";
export {
  insertContentItem,
  getContentItem,
  listContentItems,
  type ContentListFilters,
  updateContentItem,
  annotateSeoProposal,
  transitionContentItem,
  applyTransition,
  decideContentItem,
  type ProposalDecision,
  publishContentItem,
  publishThroughReview,
  ContentNotFoundError,
  type ContentType,
  type ContentItemRow,
  type NewContentItem,
} from "./content.repo";
export {
  nextStatus,
  InvalidTransitionError,
  type PublicationEvent,
} from "./state-machine";
export {
  PostgresAgentProposalStore,
  ProposalNotFoundError,
  ProposalNotPendingError,
  EmailSinkNotConfiguredError,
  type AgentProposalStore,
  type StagedProposal,
  type EmailDraftSink,
} from "./agent-proposal-store";
