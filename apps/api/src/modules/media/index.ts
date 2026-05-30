// Public surface of the Media-DAM module.
export { ingestPhoto, type MediaDeps, type IngestPhotoInput, type IngestResult } from "./media.service";
export { S3Storage, type StoragePort, type S3StorageConfig } from "./storage";
export { extractPhotoMeta } from "./exif";
export { makeVariants, type PhotoVariants } from "./variants";
export {
  matchPhotoToSegment,
  haversineKm,
  type PhotoMeta,
  type DatedPlace,
} from "./matching";
export {
  insertMediaAsset,
  getMediaAsset,
  type MediaAssetRow,
  type NewMediaAsset,
} from "./media.repo";
