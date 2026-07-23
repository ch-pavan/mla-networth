import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { basePath } from "../lib/public-url";
import {
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
  absoluteUrl,
} from "../lib/site";
import "./globals.css";

async function requestBaseUrl(): Promise<URL> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      return new URL(process.env.NEXT_PUBLIC_SITE_URL);
    } catch {
      /* fall through */
    }
  }

  try {
    const requestHeaders = await headers();
    const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))
      ?.split(",")[0]
      .trim();

    if (host && !host.includes("localhost")) {
      const forwardedProtocol = requestHeaders.get("x-forwarded-proto")
        ?.split(",")[0]
        .trim();
      const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
        ? forwardedProtocol
        : "https";
      return new URL(`${protocol}://${host}`);
    }
  } catch {
    /* static generation / no request context */
  }

  return new URL(SITE_URL);
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = await requestBaseUrl();
  const pageRoot = new URL(metadataBase);
  if (!pageRoot.pathname.endsWith("/")) pageRoot.pathname += "/";
  const socialImage = [{
    url: new URL("og.png", pageRoot),
    width: 1731,
    height: 909,
    alt: "NetaWorth — declared assets of India’s elected representatives",
  }];

  return {
    metadataBase,
    title: {
      default: SITE_TITLE,
      template: `%s · ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME, url: SITE_URL }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: "politics",
    alternates: {
      canonical: "/",
    },
    icons: {
      icon: pageRoot ? new URL("favicon.svg", pageRoot) : `${basePath}/favicon.svg`,
      shortcut: pageRoot ? new URL("favicon.svg", pageRoot) : `${basePath}/favicon.svg`,
    },
    openGraph: {
      type: "website",
      locale: "en_IN",
      url: absoluteUrl("/"),
      siteName: SITE_NAME,
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: socialImage,
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: socialImage.map((image) => image.url),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? {
          verification: {
            google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
          },
        }
      : {}),
  };
}

function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en-IN",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: absoluteUrl("/favicon.svg"),
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "Dataset",
        "@id": `${SITE_URL}/#dataset`,
        name: "Indian election affidavit wealth declarations",
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        creator: { "@id": `${SITE_URL}/#organization` },
        license: "https://creativecommons.org/licenses/by/4.0/",
        isAccessibleForFree: true,
        keywords: SITE_KEYWORDS,
      },
    ],
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = jsonLd();
  return (
    <html lang="en-IN">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
