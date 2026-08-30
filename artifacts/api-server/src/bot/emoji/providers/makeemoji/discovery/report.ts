// ─────────────────────────────────────────────────────────────────────────────
// Discovery report.
//
// The report is written for a person deciding what to do next, so it leads with
// the verdict and the exact follow-up actions, and only then shows the evidence.
// Anything the run could NOT establish is stated plainly — an honest gap is what
// tells the reader which part still needs a human eye.
// ─────────────────────────────────────────────────────────────────────────────

import type { DiscoveryOutcome } from "./discover.js";
import type { RecordedExchange } from "./recorder.js";

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_none_\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(r => `| ${r.map(c => c.replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n") + "\n";
}

function summarise(x: RecordedExchange): string[] {
  return [
    x.method,
    x.url.length > 90 ? `${x.url.slice(0, 90)}…` : x.url,
    x.resourceType,
    x.status === null ? (x.failure ?? "—") : String(x.status),
    x.contentType ?? "—",
    x.postData ? `${x.postData.length}b` : "—",
  ];
}

/**
 * The verdict, combining static bundle evidence with what the run actually saw.
 *
 * Bundle signatures alone are weak: a minified or inlined encoder leaves no
 * recognisable string, which is how a genuinely client-side site ends up
 * "inconclusive". Runtime evidence is much stronger — if the run uploaded an
 * image, got a finished file back, and NOTHING carrying a body left the page,
 * generation happened in the browser. That is a conclusion, not a guess.
 */
export function verdictFor(o: DiscoveryOutcome, generationCandidates: unknown[]): {
  verdict: string; observed: boolean;
} {
  const staticVerdict = o.processing?.verdict ?? "inconclusive";
  const nothingLeftThePage = generationCandidates.length === 0;

  if (o.result.obtained && nothingLeftThePage && staticVerdict !== "backend") {
    return { verdict: "client-side", observed: true };
  }
  if (o.result.obtained && !nothingLeftThePage && staticVerdict === "inconclusive") {
    return { verdict: "backend", observed: true };
  }
  return { verdict: staticVerdict, observed: false };
}

export function buildReport(o: DiscoveryOutcome): string {
  const reachable = o.reachability.some(r => r.ok);
  const uploadStep = o.steps.find(s => s.step === "upload");
  const generationCandidates = o.candidates.filter(
    x => x.method !== "GET" && x.postData !== null,
  );
  // One source of truth: discover.ts stores the verdict on the outcome.
  const { observed } = verdictFor(o, generationCandidates);
  const verdict = o.verdict;

  const lines: string[] = [];

  lines.push("# MakeEmoji investigation", "");
  lines.push(`- **Site:** ${o.siteUrl}`);
  lines.push(`- **Run at:** ${o.startedAt}`);
  lines.push(`- **Reachable from this host:** ${reachable ? "yes" : "**NO**"}`);
  lines.push(`- **Processing verdict:** ${verdict}${observed ? " (from observed behaviour)" : " (from bundle analysis)"}`);
  lines.push(`- **Manifest verified:** ${o.manifest.verified ? "yes" : "**no**"}`);
  lines.push(`- **Result file retrieved:** ${o.result.obtained ? `yes, via ${o.result.via} (${o.result.bytes} bytes)` : "**no**"}`);
  lines.push("");

  // ── the answer, up front ──────────────────────────────────────────────────
  lines.push("## Verdict", "");
  if (!reachable) {
    lines.push(
      "This host could not reach the site at all, so nothing below is evidence about MakeEmoji —",
      "only about the network path. Re-run from a host with outbound access.", "",
    );
  } else if (verdict === "client-side") {
    lines.push(
      observed
        ? "The run uploaded an image, got a finished file back, and **nothing carrying a body left the page**."
        : "The bundles carry an in-browser encoder and no generation endpoint was observed.",
      "MakeEmoji renders in the browser, which means **there is no backend request to",
      "reproduce** — the browser provider is the integration, not a fallback. Leave",
      "`manifest.api` null.", "",
    );
  } else if (verdict === "backend") {
    lines.push(
      "The evidence points at server-side generation. Check the request shortlist below:",
      "the request that carried the image is the one to reproduce in `api.ts`.", "",
    );
  } else if (verdict === "mixed") {
    lines.push(
      "Both an in-browser encoder and backend calls are present. Decide from the shortlist which",
      "one actually produced the output — the other is likely uploads, analytics or asset fetching.", "",
    );
  } else {
    lines.push(
      "Inconclusive. The run did not gather enough to say where processing happens; see the gaps below.", "",
    );
  }

  // ── what to do next ───────────────────────────────────────────────────────
  lines.push("## Next actions", "");
  const actions: string[] = [];
  if (!reachable) {
    actions.push("Run this from a host that can reach makeemoji.com (the bot server, a VPS, or your laptop).");
  }
  if (!o.manifest.browser.fileInputSelector) {
    actions.push("No `<input type=file>` was found. The editor may put the upload behind a click — open the site, start an upload manually, and add the real selector to `browser.fileInputSelector`.");
  }
  if (!o.manifest.controls.animation?.values.length) {
    actions.push("No animation vocabulary was captured. Read the control inventory below, find the animation picker, and fill `controls.animation` in the manifest by hand.");
  }
  if (generationCandidates.length > 0 && o.manifest.api === null) {
    actions.push(`${generationCandidates.length} request(s) carried a body and could be the generation call. Confirm which, then fill the \`api\` block in the manifest to enable the direct-HTTP path.`);
  }
  if (!o.result.obtained) {
    actions.push("The run never got a finished file. Check the `generate`/`retrieve` step failures below — the trigger or the preview selector is probably different from the guess.");
  }
  if (o.manifest.verified) {
    actions.push("Manifest is verified: copy `manifest.json` over `src/bot/emoji/providers/makeemoji/manifest.json` and restart the bot.");
  }
  lines.push(actions.length ? actions.map(a => `- ${a}`).join("\n") : "- Nothing outstanding.", "");

  // ── steps ─────────────────────────────────────────────────────────────────
  lines.push("## Run steps", "");
  lines.push(table(["Step", "OK", "Detail"], o.steps.map(s => [s.step, s.ok ? "✅" : "❌", s.detail])));

  lines.push("## Reachability", "");
  lines.push(table(
    ["Method", "OK", "Status", "Detail"],
    o.reachability.map(r => [r.method, r.ok ? "✅" : "❌", String(r.status ?? "—"), r.detail]),
  ));

  // ── flows ─────────────────────────────────────────────────────────────────
  lines.push("## Upload flow", "");
  lines.push(uploadStep?.ok
    ? `Image accepted by \`${o.manifest.browser.fileInputSelector}\`.`
    : `Not established. ${uploadStep?.detail ?? "step did not run"}`);
  lines.push("");

  lines.push("## Generation flow", "");
  if (generationCandidates.length === 0) {
    lines.push("No body-carrying request was recorded after the image was supplied.");
    lines.push("That is the signature of in-browser generation: nothing left the page.");
  } else {
    lines.push("Requests that carried a body — one of these is the generation call:", "");
    lines.push(table(
      ["Method", "URL", "Type", "Status", "Content-Type", "Body"],
      generationCandidates.map(summarise),
    ));
  }
  lines.push("");

  lines.push("## Export / download flow", "");
  lines.push(o.result.obtained
    ? `Retrieved via **${o.result.via}** from \`${o.result.url ?? "—"}\` (${o.result.bytes} bytes). Saved to \`responses/\`.`
    : "No output file was retrieved.");
  lines.push("");

  // ── processing evidence ───────────────────────────────────────────────────
  lines.push("## Client-side processing evidence", "");
  lines.push(o.processing?.clientSide.length
    ? o.processing.clientSide.map(h => `- \`${h}\``).join("\n")
    : "_no in-browser encoder signatures found_");
  lines.push("");

  lines.push("## Backend processing evidence", "");
  lines.push(o.processing?.backend.length
    ? o.processing.backend.map(h => `- \`${h}\``).join("\n")
    : "_no backend signatures found_");
  lines.push("");

  lines.push("### Endpoint strings found in bundles", "");
  lines.push(o.processing?.endpoints.length
    ? o.processing.endpoints.map(e => `- \`${e}\``).join("\n")
    : "_none_");
  lines.push("");
  lines.push("> These are string literals, not observed calls. Treat them as leads to confirm");
  lines.push("> against the network trace — never wire one into the provider unhit.", "");

  lines.push("### Source maps", "");
  const maps = o.bundles.filter(b => b.sourceMappingUrl);
  lines.push(maps.length
    ? table(["Bundle", "Map available", "Original sources"], maps.map(b => [
        b.url.split("/").pop() ?? b.url,
        b.sourceMapAvailable ? "✅" : "❌",
        b.sourceMapAvailable ? String(b.sourceMapSources.length) : "—",
      ]))
    : "_no source maps declared_\n");

  // ── authentication ────────────────────────────────────────────────────────
  lines.push("## Authentication", "");
  const authed = o.candidates.filter(x =>
    Object.keys(x.requestHeaders).some(h => /authorization|x-api-key|x-csrf/i.test(h)));
  lines.push(authed.length
    ? `${authed.length} candidate request(s) carried an auth-ish header (values redacted). Reproducing those needs whatever establishes the credential — check whether a plain session cookie is enough.`
    : "No auth headers on any candidate request. Cookies may still matter; the direct path should be tested without them first.");
  lines.push("");

  // ── inventory ─────────────────────────────────────────────────────────────
  const inventory = o.inventoryAfterUpload ?? o.inventory;
  lines.push("## Control inventory", "");
  if (!inventory) {
    lines.push("_page was never inspected_");
  } else {
    lines.push(`Page title: \`${inventory.title}\`  ·  file inputs: ${inventory.fileInputs.length}  ·  canvases: ${inventory.clientSide.canvasCount}`, "");
    lines.push(table(
      ["Selector", "Kind", "Values", "Label (truncated)"],
      inventory.controls.map(c => [
        `\`${c.selector}\``,
        c.kind,
        c.values.length ? c.values.slice(0, 8).map(v => v.value).join(", ") : "—",
        c.label.slice(0, 60),
      ]),
    ));
    lines.push("### Action buttons", "");
    lines.push(table(["Selector", "Text"], inventory.actionButtons.map(b => [`\`${b.selector}\``, b.text])));
  }
  lines.push("");

  lines.push("## Mapped manifest controls", "");
  const mapped = Object.entries(o.manifest.controls);
  lines.push(mapped.length
    ? table(["Option", "Selector", "Kind", "Values"], mapped.map(([key, spec]) => [
        key, `\`${spec!.selector}\``, spec!.kind,
        spec!.values.length ? spec!.values.map(v => v.value).slice(0, 12).join(", ") : "—",
      ]))
    : "_nothing mapped — fill the manifest by hand from the inventory above_\n");

  lines.push("## Full request shortlist", "");
  lines.push(table(
    ["Method", "URL", "Type", "Status", "Content-Type", "Body"],
    o.candidates.slice(0, 120).map(summarise),
  ));
  lines.push(`_${o.exchanges.length} total exchanges recorded; see \`network.json\`._`, "");

  if (o.websockets.length) {
    lines.push("## WebSockets", "");
    lines.push(o.websockets.map(w => `- \`${w}\``).join("\n"), "");
  }

  lines.push("---", "");
  lines.push("_Header and query values that could authenticate as the browser are redacted in every artefact._");

  return lines.join("\n");
}
