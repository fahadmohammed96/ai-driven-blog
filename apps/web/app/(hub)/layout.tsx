import type { ReactNode } from "react";
import { color, font, space } from "../../src/ui/tokens";
import { ToolboxNav } from "./ToolboxNav";

/**
 * App-shell for the content-hub: a persistent toolbox rail beside the active
 * surface. The route group `(hub)` shares this chrome across /hub and the
 * surfaces without adding a URL segment. `/studio` and `/newsletter` live
 * outside the group and are untouched.
 */
export default function HubLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        minHeight: "100vh",
        fontFamily: font.family,
        color: color.text,
      }}
    >
      <ToolboxNav />
      <main style={{ flex: 1, minWidth: 0, padding: `${space.xl} ${space.xl} ${space["2xl"]}` }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>{children}</div>
      </main>
    </div>
  );
}
