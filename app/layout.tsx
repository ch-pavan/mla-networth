import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { basePath } from "../lib/public-url";
import "./globals.css";

const title = "NetaWorth — Follow the money. Know your neta.";
const description =
  "Explore declared assets, liabilities and wealth growth of India's elected representatives across elections and constituencies.";

async function requestBaseUrl(): Promise<URL | undefined> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      return new URL(process.env.NEXT_PUBLIC_SITE_URL);
    } catch {
      return undefined;
    }
  }

  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))
    ?.split(",")[0]
    .trim();

  if (!host) return undefined;

  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost")
      ? "http"
      : "https";

  try {
    return new URL(`${protocol}://${host}`);
  } catch {
    return undefined;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = await requestBaseUrl();
  const pageRoot = metadataBase ? new URL(metadataBase) : undefined;
  if (pageRoot && !pageRoot.pathname.endsWith("/")) pageRoot.pathname += "/";
  const socialImage = metadataBase
    ? [{ url: new URL("og.png", pageRoot), width: 1731, height: 909, alt: "NetaWorth public election affidavit archive" }]
    : undefined;

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: pageRoot ? new URL("favicon.svg", pageRoot) : `${basePath}/favicon.svg`,
      shortcut: pageRoot ? new URL("favicon.svg", pageRoot) : `${basePath}/favicon.svg`,
    },
    openGraph: {
      type: "website",
      title,
      description,
      images: socialImage,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: socialImage?.map((image) => image.url),
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
