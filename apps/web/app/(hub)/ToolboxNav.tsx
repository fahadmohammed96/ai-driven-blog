"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { color, font, gradient, NAV_WIDTH, radius, shadow, space } from "../../src/ui/tokens";
import { GROUP_LABEL, HUB_HOME, SURFACES, type Surface, type SurfaceGroup } from "./surfaces";

/**
 * Persistent toolbox rail (ADR-0020: toolbox, not wizard). Every surface is an
 * independent destination; the active one is highlighted from the current path.
 * Lives in the hub layout so it stays put across navigation (app-shell chrome).
 *
 * Redesign: a branded, grouped rail — gradient logo mark, labelled sections
 * (Crea / Cresci / Gestisci) and per-tool icon chips so the founder scans by
 * shape and color, not by reading a flat list.
 */
const GROUP_ORDER: SurfaceGroup[] = ["create", "grow", "operate"];

export function ToolboxNav() {
  const pathname = usePathname();

  return (
    <nav
      data-testid="toolbox-nav"
      aria-label="Content hub toolbox"
      style={{
        width: NAV_WIDTH,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
        overflowY: "auto",
        borderRight: `1px solid ${color.border}`,
        background: color.surface,
        padding: space.md,
        display: "flex",
        flexDirection: "column",
        gap: space.sm,
      }}
    >
      {/* Brand mark */}
      <Link
        href={HUB_HOME.href}
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          textDecoration: "none",
          padding: `${space.sm} ${space.sm} ${space.md}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            background: gradient.brand,
            boxShadow: shadow.xs,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            fontWeight: font.weight.bold,
            fontSize: "1.15rem",
          }}
        >
          B
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: font.size.md, fontWeight: font.weight.bold, color: color.text }}>
            Blogs Manager
          </span>
          <span style={{ fontSize: font.size.xs, color: color.textFaint }}>Content Hub</span>
        </span>
      </Link>

      <NavLink surface={HUB_HOME} active={pathname === HUB_HOME.href} />

      {GROUP_ORDER.map((g) => {
        const items = SURFACES.filter((s) => s.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} style={{ marginTop: space.sm }}>
            <div
              style={{
                fontSize: "0.68rem",
                fontWeight: font.weight.bold,
                color: color.textFaint,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                padding: `${space.xs} ${space.sm}`,
              }}
            >
              {GROUP_LABEL[g]}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {items.map((s) => (
                <NavLink key={s.href} surface={s} active={pathname === s.href} />
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />
      <div
        style={{
          fontSize: font.size.xs,
          color: color.textFaint,
          padding: space.sm,
          borderTop: `1px solid ${color.border}`,
          marginTop: space.sm,
        }}
      >
        L&apos;AI propone · tu confermi
      </div>
    </nav>
  );
}

function NavLink({ surface: s, active }: { surface: Surface; active: boolean }) {
  return (
    <Link
      href={s.href}
      data-testid={s.navTestId}
      aria-current={active ? "page" : undefined}
      title={s.hint}
      className="bm-nav-link"
      style={{
        display: "flex",
        alignItems: "center",
        gap: space.sm,
        padding: `${space.sm} ${space.sm}`,
        borderRadius: radius.md,
        textDecoration: "none",
        fontSize: font.size.md,
        fontWeight: active ? font.weight.semibold : font.weight.medium,
        color: active ? color.accentText : color.text,
        background: active ? color.accentSoft : "transparent",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: radius.sm,
          display: "grid",
          placeItems: "center",
          fontSize: "0.95rem",
          background: active ? "#fff" : color.surfaceMuted,
          border: `1px solid ${active ? s.accent + "55" : color.border}`,
          boxShadow: active ? `inset 0 0 0 2px ${s.accent}22` : "none",
        }}
      >
        {s.icon}
      </span>
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {s.label}
      </span>
    </Link>
  );
}
