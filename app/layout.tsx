import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";

const META_PIXEL_ID = "1308736174041664";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  weight: "400",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://getbraintech.com");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Braintech — Stop losing them to the screen.",
  description:
    "One small box. Text it your rules. Your kid earns TikTok, YouTube and Roblox by learning. Network-level — nothing on their phone to delete. Founding price $249/yr.",
  openGraph: {
    title: "Stop losing them to the screen.",
    description:
      "Text-message parental control that turns screen time into earned learning time. Nothing on their phone to delete.",
    url: siteUrl,
    siteName: "Braintech",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stop losing them to the screen.",
    description:
      "Text-message parental control that turns screen time into earned learning time.",
  },
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    title: "Braintech",
    // "default" = light status bar with dark text. Fits the cream
    // background of /app (the install target). "black-translucent"
    // would render white text over our cream bg → invisible.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  width: "device-width",
  initialScale: 1,
};

const gaId = process.env.NEXT_PUBLIC_GA_ID;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read the variation cookie that proxy.ts set on first visit. We push a
  // GA4 user_property to dataLayer BEFORE gtag.js loads so even the auto
  // page_view event is user-tagged with `variation`. Subsequent custom
  // events (waitlist_submit, conversion, chat_cta_click, etc.) inherit it.
  // "unknown" stays out of conversion data without breaking the dimension.
  const cookieStore = await cookies();
  const variation = cookieStore.get("bt_var")?.value ?? "unknown";
  const variationJSON = JSON.stringify(variation);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#f5f1ea] text-[#1a1714]">
        {children}
        {gaId ? (
          <>
            {/* Seed dataLayer with the variation user_property before
                gtag.js loads. dataLayer is a queue — pushes pre-load apply
                to the first auto page_view. */}
            <Script id="ga-variation-seed" strategy="beforeInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('set','user_properties',{variation:${variationJSON}});`}
            </Script>
            <GoogleAnalytics gaId={gaId} />
          </>
        ) : null}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView', {variation: ${variationJSON}});`}
        </Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
      </body>
    </html>
  );
}
