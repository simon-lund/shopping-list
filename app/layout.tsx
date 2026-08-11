import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Chat link previews need absolute URLs for the generated image.
  metadataBase: process.env.PUBLIC_URL
    ? new URL(process.env.PUBLIC_URL)
    : undefined,
  title: "Shopping list",
  description: "A shared shopping list for a group of people.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#161715" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
