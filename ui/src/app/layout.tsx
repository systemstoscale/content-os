import type { Metadata, Viewport } from "next";
import { Archivo_Black, Inter, Poppins } from "next/font/google";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-archivo-black",
});

export const metadata: Metadata = {
  title: "Content OS",
  description: "Run your entire content engine — ideas, drafts, reels, publishing — from your phone.",
  // No public indexing; this lives on per-student Worker subdomains.
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  applicationName: "Content OS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Content OS",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${archivoBlack.variable}`}>
      <body className="min-h-safe-screen pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Providers>{children}</Providers>
        <BottomNav />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
