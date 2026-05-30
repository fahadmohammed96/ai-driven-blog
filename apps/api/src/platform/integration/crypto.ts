import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Seal/open secrets at rest (PRODUCT: per-tenant tokens encrypted). AES-256-GCM
 * with a random per-message IV; the stored form is `iv:tag:ciphertext` (base64).
 * The key is derived from a master secret via scrypt.
 */
const ALGO = "aes-256-gcm";

function deriveKey(masterSecret: string): Buffer {
  // Static salt: the master secret is the actual secret; salt only domain-separates.
  return scryptSync(masterSecret, "blogs-connector-creds", 32);
}

export function sealSecret(plaintext: string, masterSecret: string): string {
  const key = deriveKey(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function openSecret(sealed: string, masterSecret: string): string {
  const [ivB64, tagB64, encB64] = sealed.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("malformed sealed secret");
  const key = deriveKey(masterSecret);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
