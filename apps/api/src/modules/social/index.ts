// Public surface of the social/distribution module.
export { SocialModule } from "./social.module";
export {
  repurpose,
  projectToChannel,
  toThread,
  deriveHashtags,
  truncateWords,
  articleParagraphs,
  firstImageAssetId,
  ChannelRequiresImageError,
  type ArticleContent,
} from "./repurpose";
export {
  repurposeArticle,
  getChannelPosts,
  NotAnArticleError,
  type RepurposeOptions,
} from "./distribution";
export {
  insertChannelPosts,
  listChannelPosts,
  type ChannelPostRow,
} from "./social.repo";
