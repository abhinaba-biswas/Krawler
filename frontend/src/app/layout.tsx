import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Krawler — Distributed Web Crawling Platform",
  description:
    "Production-grade web crawling and data extraction platform. Extract structured data from any website.",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Krawler",
    description: "Distributed crawling & data extraction platform",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f5ef7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
              {children}
            </main>
            <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
              Krawler v2.0 &mdash; Distributed crawling platform
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
