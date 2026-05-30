import { describe, it, expect } from "vitest";
import { TokenBucket } from "./token-bucket";

describe("TokenBucket", () => {
  it("allows up to capacity, then refuses", () => {
    const t = 0;
    const b = new TokenBucket({ capacity: 3, refillPerSec: 1, now: () => t });
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false); // bucket empty
  });

  it("refills over time at the configured rate", () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 2, now: () => t });
    expect(b.tryRemove(2)).toBe(true);
    expect(b.tryRemove()).toBe(false);
    t = 500; // 0.5s * 2/s = 1 token
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });

  it("never refills past capacity", () => {
    let t = 0;
    const b = new TokenBucket({ capacity: 2, refillPerSec: 10, now: () => t });
    t = 10_000; // long idle
    expect(b.available()).toBe(2);
  });
});
