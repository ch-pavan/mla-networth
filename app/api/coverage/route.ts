import { env } from "cloudflare:workers";

export async function GET() {
  const [totals, byState, imports] = await env.DB.batch([
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM states) AS states,
      (SELECT COUNT(*) FROM constituencies) AS constituencies,
      (SELECT COUNT(*) FROM people) AS people,
      (SELECT COUNT(*) FROM candidacies) AS candidacies,
      (SELECT COUNT(*) FROM affidavits) AS affidavits,
      (SELECT COUNT(*) FROM affidavits WHERE verification_status='verified') AS verified_affidavits,
      (SELECT MIN(year) FROM elections) AS first_year,
      (SELECT MAX(year) FROM elections) AS latest_year`),
    env.DB.prepare(`SELECT s.name, s.assembly_seats,
      COUNT(DISTINCT co.id) AS constituencies_indexed,
      COUNT(DISTINCT CASE WHEN c.winner=1 THEN c.id END) AS winners_indexed,
      COUNT(a.id) AS affidavits_indexed
      FROM states s LEFT JOIN constituencies co ON co.state_id=s.id
      LEFT JOIN candidacies c ON c.constituency_id=co.id
      LEFT JOIN affidavits a ON a.candidacy_id=c.id
      GROUP BY s.id ORDER BY s.name`),
    env.DB.prepare(`SELECT source_kind, source_url, completed_at, rows_seen, rows_accepted, rows_rejected, status
      FROM data_imports ORDER BY id DESC LIMIT 20`),
  ]);
  return Response.json({ totals: totals.results[0] ?? {}, states: byState.results, imports: imports.results }, { headers: { "Cache-Control": "public, max-age=300" } });
}
