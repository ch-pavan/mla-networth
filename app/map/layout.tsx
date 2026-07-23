import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "India wealth map — MLA, Lok Sabha & Rajya Sabha",
  description:
    "Interactive map of declared assets for India’s sitting MLAs, Lok Sabha winners and Rajya Sabha MPs by state and constituency.",
  alternates: { canonical: "/map" },
  openGraph: {
    title: "NetaWorth map — declared political wealth across India",
    description:
      "State and constituency map of self-declared MLA and MP assets from election affidavits.",
    url: "/map",
  },
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
