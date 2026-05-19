import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  subsets: ["latin"],
});

const siteUrl = "https://braintech.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Braintech — Your kid wants TikTok. Make them earn it.",
  description:
    "Text-message parental control for every screen in your house. Turn screen time into earned learning time. Founding members: $249/year, 1,000 devices.",
  openGraph: {
    title: "Your kid wants TikTok. Make them earn it.",
    description:
      "Text-message parental control that turns screen time into earned learning time. Founding members: $249/year.",
    url: siteUrl,
    siteName: "Braintech",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your kid wants TikTok. Make them earn it.",
    description:
      "Text-message parental control that turns screen time into earned learning time.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  width: "device-width",
  initialScale: 1,
};

const gaId = process.env.NEXT_PUBLIC_GA_ID;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f5f1ea] text-[#1a1714]">
        {children}
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  );
}
