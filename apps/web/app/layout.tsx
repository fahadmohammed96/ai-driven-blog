import type { ReactNode } from "react";

export const metadata = {
  title: "Blogs Manager",
  description: "AI-first multi-tenant blog hub",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
