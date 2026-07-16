import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the NetaWorth product experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NetaWorth — Follow the money\. Know your neta\.<\/title>/i);
  assert.match(html, /India&#x27;s most ambitious public record/);
  assert.match(html, /The wealth table/);
  assert.match(html, /Declared assets over time/);
  assert.match(html, /State of wealth/);
  assert.match(html, /Signals in the declarations/);
  assert.match(html, /Public records/);
  assert.match(html, /D\. K\. Shivakumar/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships source links and appropriate data caveats", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /https:\/\/affidavit\.eci\.gov\.in\//);
  assert.match(html, /https:\/\/www\.myneta\.info\//);
  assert.match(html, /self-sworn election affidavit/);
  assert.match(html, /not independently audited market wealth/);
  assert.match(html, /curated demonstration index/);
});
