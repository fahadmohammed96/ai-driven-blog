import { describe, it, expect } from "vitest";
import { AuthService } from "./auth.service";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("s3cret-passphrase");
    expect(verifyPassword("s3cret-passphrase", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });
});

describe("AuthService", () => {
  const service = new AuthService({
    founderEmail: "founder@blogs.dev",
    founderPasswordHash: hashPassword("correct horse battery staple"),
    jwtSecret: "test-secret",
  });

  it("issues a verifiable token for the founder with correct credentials", () => {
    const { token } = service.login("founder@blogs.dev", "correct horse battery staple");
    expect(token.length).toBeGreaterThan(0);
    expect(service.verify(token).sub).toBe("founder@blogs.dev");
  });

  it("rejects a wrong password", () => {
    expect(() => service.login("founder@blogs.dev", "nope")).toThrow();
  });

  it("rejects an unknown email", () => {
    expect(() => service.login("intruder@evil.com", "correct horse battery staple")).toThrow();
  });

  it("rejects a tampered token", () => {
    expect(() => service.verify("not.a.real.token")).toThrow();
  });
});
