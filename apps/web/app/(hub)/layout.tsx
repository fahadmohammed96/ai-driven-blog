import type { ReactNode } from "react";
import { color, font, space } from "../../src/ui/tokens";
import { ToolboxNav } from "./ToolboxNav";

/**
 * App-shell for the content-hub: a persistent toolbox rail beside the active
 * surface. The route group `(hub)` shares this chrome across /hub and the 4
 * surfaces without adding a URL segment. `/studio` and `/newsletter` live
 * outside the group and are untouched.
 */
export default function HubLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: font.family,
        color: color.text,
        background: color.bg,
      }}
    >
      <ToolboxNav />
      <main style={{ flex: 1, padding: space.xl, maxWidth: 960 }}>{children}</main>
    </div>
  );
}
