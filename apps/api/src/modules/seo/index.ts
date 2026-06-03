// Public surface of the SEO module.
export { SeoModule } from "./seo.module";
export {
  SeoAgent,
  slugify,
  uniqueSlug,
  READABILITY_ESCALATION_THRESHOLD,
  type SeoAccessors,
  type SeoAgentDeps,
  type SeoRunInput,
} from "./agents/seo-agent";
export {
  scoreReadability,
  seoAnalyze,
  countSyllables,
  type SeoAnalysis,
} from "./agents/tools/score-readability";
export {
  makeInternalLinkCandidatesAccessor,
  makeExistingContentAccessor,
} from "./seo.accessors";
