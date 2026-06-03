// Public surface of the monetization module.
export { MonetizationModule } from "./monetization.module";
export {
  insertAffiliateLink,
  getAffiliateLink,
  getAffiliateLinkByCode,
  updateAffiliateLink,
  recordClick,
  listLinksWithClicks,
  countClicksByLink,
  countClicksByArticle,
  countClicksByChannel,
  DuplicateCodeError,
  type AffiliateLinkRow,
  type AffiliateLinkWithClicks,
  type NewAffiliateLink,
} from "./affiliate.repo";
