import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Blogs Manager",
  description: "AI-first multi-tenant blog hub",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <head>
        {/* Inter webfont — loaded at runtime; the system stack in globals.css is
            the graceful fallback so an offline build/CI never breaks on it. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
