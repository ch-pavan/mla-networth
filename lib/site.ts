/** Canonical production host for SEO, sitemaps, and absolute metadata. */
export const SITE_URL = "https://netaworth.vercel.app";

export const SITE_NAME = "NetaWorth";

export const SITE_TITLE =
  "NetaWorth — Declared assets of India’s MLAs, Lok Sabha & Rajya Sabha MPs";

export const SITE_DESCRIPTION =
  "Search and compare self-declared assets, liabilities and wealth growth of India’s sitting MLAs and MPs from ECI / ADR / MyNeta election affidavits. Open data map and public records.";

export const SITE_KEYWORDS = [
  "NetaWorth",
  "MLA assets",
  "MP assets India",
  "election affidavit",
  "declared wealth",
  "Lok Sabha net worth",
  "Rajya Sabha assets",
  "MyNeta",
  "ADR",
  "ECI affidavit",
  "Indian politicians wealth",
  "sitting MLA assets",
];

export function absoluteUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalized, SITE_URL).toString();
}
