import { describe, it, expect } from "vitest";
import { sealSecret, openSecret } from "./crypto";

const KEY = "test-master-secret-key";

describe("connector secret sealing", () => {
  it("round-trips a secret", () => {
    const sealed = sealSecret("refresh-token-xyz", KEY);
    expect(sealed).not.toContain("refresh-token-xyz");
    expect(openSecret(sealed, KEY)).toBe("refresh-token-xyz");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(sealSecret("same", KEY)).not.toBe(sealSecret("same", KEY));
  });

  it("fails to open with the wrong key", () => {
    const sealed = sealSecret("secret", KEY);
    expect(() => openSecret(sealed, "wrong-key")).toThrow();
  });

  it("fails to open tampered ciphertext (auth tag)", () => {
    const sealed = sealSecret("secret", KEY);
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => openSecret(tampered, KEY)).toThrow();
  });
});
