"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { color, font, NAV_WIDTH, radius, space } from "../../src/ui/tokens";
import { HUB_HOME, SURFACES } from "./surfaces";

/**
 * Persistent toolbox rail (ADR-0020: toolbox, not wizard). Every surface is an
 * independent destination; the active one is highlighted from the current path.
 * Lives in the hub layout so it stays put across navigation (app-shell chrome).
 */
export function ToolboxNav() {
  const pathname = usePathname();
  const items = [HUB_HOME, ...SURFACES];

  return (
    <nav
      data-testid="toolbox-nav"
      aria-label="Content hub toolbox"
      style={{
        width: NAV_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid ${color.border}`,
        background: color.surface,
        padding: space.md,
        display: "flex",
        flexDirection: "column",
        gap: space.xs,
      }}
    >
      <div
        style={{
          fontSize: font.size.lg,
          fontWeight: 700,
          color: color.text,
          padding: `${space.sm} ${space.sm} ${space.md}`,
        }}
      >
        Blogs Manager
      </div>
      {items.map((s) => {
        const active = pathname === s.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            data-testid={s.navTestId}
            aria-current={active ? "page" : undefined}
            title={s.hint}
            style={{
              display: "block",
              padding: `${space.sm} ${space.md}`,
              borderRadius: radius.sm,
              textDecoration: "none",
              fontWeight: active ? 600 : 500,
              color: active ? color.accent : color.text,
              background: active ? color.accentSoft : "transparent",
            }}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
