import Link from "next/link";
import { color, font, gradient, radius, shadow, space } from "../src/ui/tokens";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: space.xl,
        fontFamily: font.family,
        color: color.text,
      }}
    >
      <div
        style={{
          maxWidth: 540,
          width: "100%",
          textAlign: "center",
          background: color.surface,
          border: `1px solid ${color.border}`,
          borderRadius: radius.xl,
          boxShadow: shadow.lg,
          padding: space["2xl"],
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 64,
            height: 64,
            borderRadius: radius.lg,
            background: gradient.brand,
            color: "#fff",
            fontSize: "2rem",
            fontWeight: font.weight.bold,
            boxShadow: shadow.card,
            marginBottom: space.lg,
          }}
        >
          B
        </span>
        <h1 style={{ fontSize: font.size["2xl"], fontWeight: font.weight.bold, margin: 0 }}>
          Blogs Manager
        </h1>
        <p style={{ color: color.textMuted, fontSize: font.size.lg, margin: `${space.sm} 0 ${space.xl}` }}>
          L&apos;AI propone, l&apos;umano conferma.
        </p>
        <Link
          href="/hub"
          style={{
            display: "inline-block",
            background: color.accent,
            color: "#fff",
            textDecoration: "none",
            fontWeight: font.weight.semibold,
            fontSize: font.size.md,
            padding: `${space.sm} ${space.xl}`,
            borderRadius: radius.md,
            boxShadow: shadow.card,
          }}
        >
          Apri il Content Hub →
        </Link>
      </div>
    </main>
  );
}
