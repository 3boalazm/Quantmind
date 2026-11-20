import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter/standard.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import { ServiceWorker } from "@/shell/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "QuantMind | محفظتي", template: "%s | QuantMind" },
  description: "متابعة محفظة استثمار متوافقة مع الشريعة: التوزيع، خطة الشراء الشهرية، والتنبيهات.",
  applicationName: "QuantMind",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "QuantMind", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#d9dad5" },
    { media: "(prefers-color-scheme: dark)", color: "#060607" },
  ],
};

// Applies the saved theme before first paint, so a dark-mode user never sees a light flash.
const themeScript = `try{if(localStorage.getItem("quantmind:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
