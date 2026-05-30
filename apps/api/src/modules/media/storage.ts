import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Object storage seam (S3-compatible: AWS S3 in prod, MinIO in dev/test). */
export interface StoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** A time-limited GET URL — lets the browser fetch a private object directly. */
  presignGet(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** MinIO needs path-style addressing (no virtual-hosted buckets). */
  forcePathStyle?: boolean;
}

export class S3Storage implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: cfg.forcePathStyle ?? true,
    });
    this.bucket = cfg.bucket;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async presignGet(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
