import { describe, it, expect } from "vitest";
import { renderConfirmEmail, renderNewsletter } from "./render";

describe("email rendering", () => {
  it("confirmation email carries the tokenized confirm link and the themes", () => {
    const msg = renderConfirmEmail({
      to: "alice@example.com",
      confirmUrl: "https://blog.test/newsletter/confirm?token=abc123",
      themes: ["party", "natura"],
    });
    expect(msg.to).toBe("alice@example.com");
    expect(msg.html).toContain("token=abc123");
    expect(msg.text).toContain("token=abc123");
    expect(msg.html).toContain("party, natura");
  });

  it("newsletter always includes an unsubscribe link", () => {
    const msg = renderNewsletter({
      to: "alice@example.com",
      subject: "Novità di primavera",
      html: "<h1>Ciao!</h1>",
      unsubscribeUrl: "https://blog.test/newsletter/unsubscribe?token=zzz",
    });
    expect(msg.subject).toBe("Novità di primavera");
    expect(msg.html).toContain("https://blog.test/newsletter/unsubscribe?token=zzz");
    expect(msg.html).toContain("<h1>Ciao!</h1>");
  });
});
