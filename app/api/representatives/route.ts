import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const state = (url.searchParams.get("state") ?? "").trim().slice(0, 60);
  const sort = url.searchParams.get("sort") ?? "assets";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const orderBy = sort === "liabilities" ? "a.liabilities_rupees" : sort === "cases" ? "a.criminal_cases" : "a.total_assets_rupees";
  const clauses = ["c.winner = 1"];
  const values: (string | number)[] = [];
  if (query) {
    clauses.push("(p.canonical_name LIKE ? OR co.name LIKE ? OR pt.abbreviation LIKE ?)");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (state) { clauses.push("s.name = ?"); values.push(state); }
  values.push(limit);
  const result = await env.DB.prepare(`
    SELECT p.id, p.canonical_name AS name, p.slug, s.name AS state,
      co.name AS constituency, co.eci_number AS constituency_number,
      pt.abbreviation AS party, e.year, a.total_assets_rupees AS total_assets,
      a.liabilities_rupees AS liabilities, a.criminal_cases,
      a.affidavit_url, a.source_kind, a.verification_status
    FROM affidavits a
    JOIN candidacies c ON c.id = a.candidacy_id
    JOIN people p ON p.id = c.person_id
    JOIN elections e ON e.id = c.election_id
    JOIN constituencies co ON co.id = c.constituency_id
    JOIN states s ON s.id = co.state_id
    LEFT JOIN parties pt ON pt.id = c.party_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy} DESC
    LIMIT ?
  `).bind(...values).all();
  return Response.json({ data: result.results, count: result.results.length, source: "NetaWorth D1 affidavit index" }, { headers: { "Cache-Control": "public, max-age=300" } });
}
