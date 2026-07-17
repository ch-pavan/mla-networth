import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About, methodology and corrections — NetaWorth",
  description: "How NetaWorth sources, connects and corrects election-affidavit records.",
};

export default function AboutPage() {
  return (
    <><a className="skipLink" href="#main-content">Skip to project information</a><main className="infoPage" id="main-content">
      <header className="topbar personNav">
        <Link className="brand" href="/" aria-label="NetaWorth home">
          <span className="brandMark">न</span><span>NETA<strong>WORTH</strong></span>
        </Link>
        <nav aria-label="Primary" className="mapPageNav">
          <Link href="/">Database</Link>
          <Link href="/map">Map</Link>
          <Link href="/about" aria-current="page">About</Link>
        </nav>
      </header>

      <section className="infoHero">
        <span className="sectionNo">ABOUT THE LEDGER</span>
        <h1>Public records,<br />carefully connected.</h1>
        <p>NetaWorth makes election-affidavit data easier to search without turning declarations into allegations.</p>
      </section>

      <div className="infoContent">
        <nav aria-label="About page sections">
          <a href="#data">Data</a><a href="#methodology">Methodology</a><a href="#corrections">Corrections</a><a href="#limitations">Limitations</a>
        </nav>
        <div>
          <section id="data">
            <span>01 / DATA</span><h2>What the figures mean</h2>
            <p>Every financial figure is transcribed from a candidate&apos;s self-sworn election affidavit. “Net worth” means declared total assets minus declared liabilities. It is not an independently audited estimate of market wealth.</p>
            <p>The current index is based on the ADR 2025 sitting-MLA appendix. Historical comparisons and election archives are derived from published MyNeta records, with Election Commission affidavits treated as the primary source for verification.</p>
          </section>
          <section id="methodology">
            <span>02 / METHODOLOGY</span><h2>How records are connected</h2>
            <p>Current-representative histories are shown only when state, normalized name, election year and the exact declared asset value match, and every older point forms a contiguous year-and-value chain. A matching name by itself is never enough to present a verified timeline.</p>
            <p>Candidate affidavits remain individual records until a canonical identity has been verified. Constituency names are retained as published because delimitation, renaming and spelling changes can make automatic lineage unsafe.</p>
          </section>
          <section id="corrections">
            <span>03 / CORRECTIONS</span><h2>How to report a problem</h2>
            <p>When reporting a possible error, include the NetaWorth record ID, the field that appears wrong, and a link or copy of the relevant Election Commission affidavit. This gives maintainers enough evidence to correct the source record and regenerate affected datasets.</p>
            <p>Do not send sensitive information that is absent from the public affidavit. Corrections should improve the fidelity of the public record, not add private data.</p>
            <a className="correctionLink" href="https://github.com/ch-pavan/mla-networth/issues/new?labels=data-correction" target="_blank" rel="noreferrer">Open a data-correction request ↗</a>
          </section>
          <section id="limitations">
            <span>04 / LIMITATIONS</span><h2>Read as a lead, not a verdict</h2>
            <p>Asset changes may reflect income, inheritance, business interests, valuation changes, debt, spouse or dependent holdings, or corrections between filings. A declared increase does not by itself establish wrongdoing.</p>
            <p>Before publishing an investigation or making a legal claim, inspect the cited affidavit and confirm the candidate&apos;s identity independently.</p>
          </section>
        </div>
      </div>
    </main></>
  );
}
