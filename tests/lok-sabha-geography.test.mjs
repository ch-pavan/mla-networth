/** Parse Lok Sabha constituency → state labels from a MyNeta index page. Smoke test fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  parseLokSabhaConstituencyStates,
  resolveLokSabhaState,
} from "../scripts/lib/lok-sabha-geography.mjs";

test("maps GUNTUR to Andhra Pradesh from Lok Sabha index markup", () => {
  const html = `
    <button onclick="handle_dropdown('item', '2')"> ANDHRA PRADESH <span class='w3-right'><i class='fa fa-caret-down'></i></span></button>
    <div>
      <a href=index.php?action=show_candidates&constituency_id=13>GUNTUR</a>
      <a href=index.php?action=show_candidates&constituency_id=7>AMALAPURAM (SC)</a>
    </div>
  `;
  const map = parseLokSabhaConstituencyStates(html);
  assert.equal(resolveLokSabhaState("GUNTUR", map), "Andhra Pradesh");
  assert.equal(resolveLokSabhaState("AMALAPURAM (SC)", map), "Andhra Pradesh");
});

test("fixture file from live fetch resolves when present", async () => {
  try {
    const html = await readFile("/tmp/ls2024.html", "utf8");
    const map = parseLokSabhaConstituencyStates(html);
    assert.ok(map.size > 400);
    assert.equal(resolveLokSabhaState("GUNTUR", map), "Andhra Pradesh");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
});
