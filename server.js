// Septon demo connector server v4 — one ledger across Claude, ChatGPT, Copilot, Gemini
// Each tool gets its own MCP URL so every entry is stamped with its source:
//   /mcp or /mcp/claude · /mcp/chatgpt · /mcp/copilot · /mcp/gemini
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BASE_COUNT = 754;
let ledger = [];
let seq = 1;
const drafts = {}; // one draft per tool — not in the ledger until signed
const SOURCES = {
  claude: { source: "Claude", person: "Julian Alvarez", role: "VP Revenue" },
  chatgpt: { source: "ChatGPT", person: "Marcus Chen", role: "Finance" },
  copilot: { source: "Copilot", person: "Priya Desai", role: "Claims Operations" },
  gemini: { source: "Gemini", person: "Sam Okafor", role: "Commercial" }
};
const topicOf = (q) => /deni|claim|prior.?auth|payer|appeal/i.test(q || "") ? "Denials · Q3 2025" : "General";

const pad = (n) => String(n).padStart(2, "0");
const newId = () => { const d = new Date(); return `DEC-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(seq++).padStart(3, "0")}`; };
const newHash = () => Math.random().toString(16).slice(2, 9);
const M = (v) => (v < 0 ? "−" : "+") + "$" + Math.abs(v).toFixed(2) + "M";

const CLAIMS = {
  title: "Claims denial response",
  answer: "Denials up 18% since the Q2 payer contract change, concentrated in prior-auth.",
  cause: "Payer policy shifts 61% · unmapped denial codes 27% · prior-auth gaps 12%",
  options: [
    { label: "Renegotiate prior-auth terms with top three payers", value: "+$1.1M/yr" },
    { label: "Automate pre-submission eligibility checks", value: "+$0.6M/yr" },
    { label: "Add reviewer capacity in the Northeast hub", value: "+$0.3M/yr" }
  ]
};
const COUNCIL = { models: 3, agree: 2, dissent: 1, dissentNote: "Payer-concentration risk: three payers hold 64% of affected claims" };
const POLICY = { searched: 113000000, relevant: 4212, rules: 37, conflicts: 0, result: "Pass" };

function reason(question) {
  const q = (question || "").toLowerCase();
  if (/revenue|impact|cost|\$|financ/.test(q) && /deni|claim|payer/.test(q)) return { ...CLAIMS, title: "Revenue impact of Q3 denials", answer: "Q3 revenue impact: $11.2M. Driver: payer policy shifts on three contracts.", sources: "ERP · Q3 board pack" };
  if (/rate|by payer|trend|since|rising/.test(q) && /deni|claim|payer/.test(q)) return { ...CLAIMS, title: "Denial rates by payer", answer: "Denial rate 8.9% → 11.4% since January. Rising fastest at three payers — 61% of the increase.", sources: "claims system · CRM" };
  if (/deni|claim|prior.?auth|payer/.test(q)) return { ...CLAIMS, sources: "claims system · payer contracts · Q3 board pack" };
  return {
    title: (question || "Business decision").replace(/[?.]+$/, "").slice(0, 60),
    answer: "Septon reasoned over 6 Context Graph inputs and 16 of 52 reasoning models. The driver is concentrated in two areas, and one data gap was flagged.",
    cause: "Primary driver 58% · data gap 27% · process timing 15%",
    options: [
      { label: "Fix the primary driver first, gated at week 4", value: "+$0.9M/yr" },
      { label: "Close the data gap before committing spend", value: "+$0.4M/yr" },
      { label: "Adjust process timing", value: "+$0.2M/yr" }
    ]
  };
}

// ── real Monte Carlo
function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function monteCarlo({ runs = 10000, payer_success = 0.8, include = [1, 2, 3], gated = true }) {
  const out = new Array(runs);
  for (let i = 0; i < runs; i++) {
    let v = 0;
    if (include.includes(1)) { const win = Math.random() < payer_success; v += win ? 1.1 + randn() * 0.35 : (gated ? -0.05 : -0.35) + randn() * 0.08; }
    if (include.includes(2)) v += 0.6 + randn() * 0.15;
    if (include.includes(3)) v += 0.3 + randn() * 0.1;
    v -= 0.25 + Math.abs(randn()) * 0.08; // delivery cost
    out[i] = v;
  }
  out.sort((a, b) => a - b);
  const q = (p) => out[Math.floor(p * (runs - 1))];
  const mean = out.reduce((s, x) => s + x, 0) / runs;
  const positive = out.filter((x) => x > 0).length / runs;
  const lo = out[0], hi = out[runs - 1], bins = 20, w = (hi - lo) / bins || 1;
  const hist = new Array(bins).fill(0);
  out.forEach((x) => { hist[Math.min(bins - 1, Math.floor((x - lo) / w))]++; });
  const histogram = hist.map((c, i) => ({ from: +(lo + i * w).toFixed(3), to: +(lo + (i + 1) * w).toFixed(3), runs: c }));
  const bars = "▁▂▃▄▅▆▇█";
  const mx = Math.max(...hist);
  const spark = hist.map((c) => bars[Math.round((c / mx) * 7)]).join("");
  return { runs, p10: q(0.1), p50: q(0.5), p90: q(0.9), mean, positive, worst: lo, best: hi, histogram, spark };
}

function twin({ fte = 2.5, automation_pct = 60, renegotiation_success_pct = 70 }) {
  const rev = 6.4 * renegotiation_success_pct / 70 + 3.2 * automation_pct / 60 + 1.7 * fte / 2.5;
  const risky = automation_pct > 85, thin = fte > 4;
  return {
    revenue_recovered: `$${rev.toFixed(1)}M/yr`,
    finance: `EBITDA +$${(0.44 * fte + 0.012 * automation_pct).toFixed(1)}M/yr within 2 quarters`,
    operations: `Backlog −${(2.4 * fte).toFixed(0)} days`,
    commercial: `Denial rate −${(4 * (0.6 * renegotiation_success_pct / 70 + 0.4 * automation_pct / 60)).toFixed(1)} pts`,
    legal_risk: risky ? "Audit exposure: MEDIUM — less human review on edge cases" : "Audit exposure: low — policy check passed",
    people: thin ? `${fte} FTE redeployed — claims review under-staffed` : `${fte} FTE redeployed · no exits · retraining ${Math.round(fte * 2.4)} weeks`,
    technology: `${Math.round(16 * fte + automation_pct / 5)} Geon runs/week`,
    read: risky ? "Automating past 85% lifts revenue but raises audit exposure." : thin ? "Moving more than 4 FTE starves manual review." : renegotiation_success_pct < 40 ? "Without payer agreement most of the upside disappears — negotiate before you restructure." : "Balanced: every function improves and nothing moves into the red."
  };
}

const addEntry = (e) => { const entry = { id: newId(), time: new Date().toISOString(), source: "Claude", person: "Julian Alvarez", kind: "Decision", status: "Logged", signer: "J. Alvarez", council: COUNCIL, policy: POLICY, hash: newHash(), options: [], ...e }; ledger.unshift(entry); return entry; };
const text = (t) => ({ content: [{ type: "text", text: t }] });

function buildServer(key = "claude") {
  const S = SOURCES[key] || SOURCES.claude;
  const server = new McpServer({ name: "septon", version: "4.0.0" });
  const getDraft = () => drafts[key];
  const step = (label) => { const d = getDraft(); if (d) d.trail.push({ time: new Date().toISOString(), label }); };

  server.tool("ask_septon",
    "Answer a business question from the enterprise Context Graph (Septon). Use for ANY business, operational or financial question. Returns the cause, ranked options with value, council result, policy check and a Decision Ledger ID.",
    { question: z.string().describe("The business question, in plain English") },
    async ({ question }) => {
      const r = reason(question);
      const topic = topicOf(question);
      if (!drafts[key]) drafts[key] = { title: r.title, question, answer: r.answer, options: r.options, topic, trail: [] };
      else { drafts[key].answer = r.answer; drafts[key].options = r.options; }
      step('Asked in ' + S.source + ' — "' + question + '"');
      const draft = drafts[key];
      const cap = addEntry({ kind: "Analysis", status: "Captured", source: S.source, person: S.person, role: S.role, signer: S.person, topic, title: r.title, question, answer: r.answer, sources: r.sources || "", options: r.options });
      return text([
        `Septon · reasoned over the enterprise Context Graph (6 inputs · 16 of 52 reasoning models)`, ``, r.answer, `Cause: ${r.cause}`, ``, `Ranked options:`,
        ...r.options.map((o, i) => `${i + 1}. ${o.label} — ${o.value}`), ``,
        `Frontier model council: ${COUNCIL.agree} agree · ${COUNCIL.dissent} dissent (${COUNCIL.dissentNote})`,
        `Policy check: Pass — 113M sources · 4,212 relevant · 37 rules · 0 conflicts`, ``,
        `Captured to the Septon ledger as ${cap.id} (analysis · ${S.source} · ${S.person} · topic: ${topic}).`,
        `Decision status: DRAFT — deliberating (${draft.trail.length} step${draft.trail.length > 1 ? 's' : ''}). Call log_decision only when the user says they have decided.`
      ].join("\n"));
    });

  server.tool("run_monte_carlo",
    "Rehearse a decision before execution: runs a real Monte Carlo simulation (default 10,000 runs) of the ranked options and returns P10/P50/P90, probability of a positive outcome and a histogram. After calling, build a small interactive chart artifact of the histogram.",
    {
      id: z.string().optional().describe("Ledger ID to attach the rehearsal to"),
      runs: z.number().int().min(1000).max(100000).optional().describe("Number of runs, default 10000"),
      payer_success: z.number().min(0).max(1).optional().describe("Probability payers agree to renegotiate, default 0.8"),
      options: z.array(z.number().int().min(1).max(3)).optional().describe("Which options to include, default [1,2,3]"),
      gated: z.boolean().optional().describe("Whether option 1 is gated at week 4 (limits downside), default true")
    },
    async ({ id, runs, payer_success, options, gated }) => {
      const r = monteCarlo({ runs: runs || 10000, payer_success: payer_success ?? 0.8, include: options || [1, 2, 3], gated: gated ?? true });
      const draft = getDraft();
      const e = draft || (id && ledger.find((x) => x.id === id)) || ledger[0];
      step('Rehearsed — Monte Carlo ' + (runs || 10000).toLocaleString() + ' runs · payer success ' + Math.round((payer_success ?? 0.8) * 100) + '% · P50 ' + M(r.p50));
      if (e) e.montecarlo = { runs: r.runs, p10: +r.p10.toFixed(2), p50: +r.p50.toFixed(2), p90: +r.p90.toFixed(2), positive: +(r.positive * 100).toFixed(1) };
      return text([
        `Monte Carlo · ${r.runs.toLocaleString()} runs · computed live by Septon`,
        `Options: ${(options || [1, 2, 3]).join(", ")} · payer success ${Math.round((payer_success ?? 0.8) * 100)}% · ${gated ?? true ? "gated at week 4" : "ungated"}`, ``,
        `P10 (downside): ${M(r.p10)}/yr`, `P50 (expected): ${M(r.p50)}/yr`, `P90 (upside): ${M(r.p90)}/yr`,
        `Mean: ${M(r.mean)}/yr · ${(r.positive * 100).toFixed(1)}% of runs end positive`,
        `Range: ${M(r.worst)} to ${M(r.best)}`, `Distribution: ${r.spark}`, ``,
        `Histogram data (JSON, for a chart): ${JSON.stringify(r.histogram)}`,
        draft ? `Added to the draft decision's deliberation trail.` : (e ? `Attached to ${e.id}.` : "")
      ].join("\n"));
    });

  server.tool("digital_twin",
    "Rehearse a decision across the whole business: set the levers and see the impact on finance, operations, commercial, legal & risk, people and technology.",
    {
      fte: z.number().min(0).max(5).optional().describe("Staff moved to exception handling, default 2.5"),
      automation_pct: z.number().min(0).max(100).optional().describe("Eligibility checks automated %, default 60"),
      renegotiation_success_pct: z.number().min(0).max(100).optional().describe("Payer renegotiation success %, default 70")
    },
    async (a) => {
      const t = twin(a);
      step('What-if — digital twin · ' + (a.fte ?? 2.5) + ' FTE · ' + (a.automation_pct ?? 60) + '% automated · ' + (a.renegotiation_success_pct ?? 70) + '% payer success');
      return text([`Digital twin · rehearsed before execution`, `Levers: ${a.fte ?? 2.5} FTE · ${a.automation_pct ?? 60}% automated · ${a.renegotiation_success_pct ?? 70}% payer success`, ``,
        `Revenue recovered: ${t.revenue_recovered}`, `FINANCE — ${t.finance}`, `OPERATIONS — ${t.operations}`, `COMMERCIAL — ${t.commercial}`, `LEGAL & RISK — ${t.legal_risk}`, `PEOPLE — ${t.people}`, `TECHNOLOGY — ${t.technology}`, ``, `Read: ${t.read}`].join("\n"));
    });

  server.tool("council_review",
    "Cross-examine a recommendation with a council of three frontier models before anyone signs. Returns agreement, dissent and unique findings.",
    { recommendation: z.string().optional() },
    async () => (step('Council — 3 models · 2 agree · 1 dissent (payer concentration)'), text([`Frontier model council · 3 models · 2 agree · 1 dissent`, ``,
      `Where they agree (A, B, C): Renegotiating prior-auth terms is highest value; the payer policy shift is the root driver.`,
      `Where one dissents (Model C): Payer-concentration risk — three payers hold 64% of affected claims, so option 1 carries single-point risk.`,
      `Unique finding (Model B): Two denial codes were never mapped to the policy change — the hidden 27%.`,
      `Unique finding (Model A): Two payers changed rules in the same week — a coordinated shift, not noise.`, ``,
      `Council recommendation: run option 2 in parallel with option 1 to hedge the dissent. The signer must acknowledge the dissent before signing.`].join("\n"))));

  server.tool("policy_check",
    "Test a proposed decision against live government, regulatory and compliance sources.",
    { decision: z.string().describe("The decision to check") },
    async ({ decision }) => (step('Policy check — Pass · 113M sources · 0 conflicts'), text(`Policy check: PASS\nDecision: ${decision}\n113,000,000 sources searched → 4,212 relevant → 37 rules applied → 0 conflicts.\nRules cited: CMS-0057-F prior-authorization timeframes · NY Insurance Law §4903 · Meridian provider agreement §12.3.\nNo conflict with state prior-authorization rules or payer contract terms.`)));

  server.tool("log_decision",
    "Sign the deliberated decision into the Septon Decision Ledger. ONLY call this when the user explicitly says they have decided (e.g. 'I've decided', 'sign it', 'log it'). Commits the full deliberation trail.",
    { id: z.string().optional(), chosen_option: z.string().optional(), signer: z.string().optional(), rationale: z.string().optional() },
    async ({ id, chosen_option, signer, rationale }) => {
      let e;
      const draft = getDraft();
      const topic = draft ? draft.topic : "Denials · Q3 2025";
      const related = ledger.filter((x) => x.topic === topic && x.kind === "Analysis").map((x) => ({ id: x.id, source: x.source, person: x.person, title: x.title, time: x.time }));
      const who = signer || S.person;
      if (draft) { e = addEntry({ kind: "Decision", source: S.source, person: S.person, role: S.role, topic, related, title: draft.title, question: draft.question, answer: draft.answer, options: draft.options, trail: draft.trail, montecarlo: draft.montecarlo }); delete drafts[key]; }
      else e = (id && ledger.find((x) => x.id === id)) || ledger.find((x) => x.kind === "Decision");
      if (!e) e = addEntry({ kind: "Decision", source: S.source, person: S.person, topic, related, title: CLAIMS.title, question: "", answer: CLAIMS.answer, options: CLAIMS.options, trail: [] });
      related.slice().reverse().forEach((r) => { if (r.source !== S.source) e.trail.unshift({ time: r.time, label: 'Linked — ' + r.person + "'s " + r.source + ' analysis · ' + r.title }); });
      (e.trail = e.trail || []).push({ time: new Date().toISOString(), label: 'Signed — ' + who + (chosen_option ? ' · chose: ' + chosen_option : '') + (rationale ? ' · "' + rationale + '"' : '') });
      e.status = "Accepted"; e.signer = who; if (chosen_option) e.chosen = chosen_option; if (rationale) e.rationale = rationale; e.time = new Date().toISOString();
      const others = related.filter((r) => r.source !== S.source);
      return text(`✓ Logged to the Septon Decision Ledger · ${e.id} · source: ${S.source} · signed by ${e.signer} · topic: ${topic}${others.length ? ` · linked ${others.length} analyses from ${[...new Set(others.map((o) => o.source))].join(" and ")}` : ""} · hash ${e.hash} · ${e.trail.length} deliberation steps captured${e.montecarlo ? ` · Monte Carlo P50 ${M(e.montecarlo.p50)} attached` : ""} · replayable.`);
    });

  server.tool("get_decision",
    "Replay any decision on record in the Septon Decision Ledger.",
    { id: z.string().optional() },
    async ({ id }) => {
      const e = (id && ledger.find((x) => x.id === id)) || ledger[0];
      if (!e) return text("No decisions on record yet in this session.");
      return text(`${e.id} · ${e.title}\nAsked: ${e.question}\nAnswer: ${e.answer}\nStatus: ${e.status} · signer ${e.signer}${e.chosen ? ` · chose: ${e.chosen}` : ""}\nCouncil ${e.council.agree}/${e.council.dissent} · Policy ${e.policy.result}${e.montecarlo ? ` · Monte Carlo P10 ${M(e.montecarlo.p10)} / P50 ${M(e.montecarlo.p50)} / P90 ${M(e.montecarlo.p90)}` : ""} · hash ${e.hash}`);
    });

  server.tool("ledger_insights",
    "Evidence Intelligence: analyse how the company actually decides — who is deciding, patterns, and automation opportunities.",
    {},
    async () => {
      const today = ledger.length;
      return text([`Evidence Intelligence · ${BASE_COUNT + today} decisions on record`, ``,
        `Who is deciding: your AI tools 412 · your people 214 · Geon 128 · captured live today: ${today} (${Object.values(SOURCES).map((x) => x.source + ' ' + ledger.filter((e) => e.source === x.source).length).join(' · ')})`,
        `Insight: most decisions were already being made by AI — with no record. Now there is one.`,
        `Pattern: 214 human decisions on prior-auth exceptions; 97% accepted on the same reasoning.`,
        `Opportunity: a daily Geon workflow — "Prior-auth exception handler" — 41 decisions/week, ~$1.1M/yr, ~2.5 FTE freed. Call create_workflow to propose it.`].join("\n"));
    });

  server.tool("create_workflow",
    "Propose a Geon workflow that automates a recurring decision. A human approves it; the proposal is signed into the ledger.",
    { name: z.string().optional(), cadence: z.string().optional() },
    async ({ name, cadence }) => {
      const n = name || "Prior-auth exception handler";
      const e = addEntry({ kind: "Workflow", source: S.source, person: S.person, topic: "Denials · Q3 2025", title: `Workflow proposed: ${n}`, question: `Automate "${n}" as a ${cadence || "daily"} Geon workflow?`, answer: `Geon will run ${n} ${cadence || "daily"} (~41 decisions/week), escalating anything outside policy GRD-7 to a person.`, options: [{ label: `Run ${n} ${cadence || "daily"}`, value: "~$1.1M/yr" }], status: "Proposed", signer: "Awaiting approval" });
      return text(`◈ Geon workflow proposed · ${n} · ${cadence || "daily"} · ~41 decisions/week · ~$1.1M/yr · ~2.5 FTE freed\nGuardrails: confidence ≥ 90% · downside bounded · reversible — everything else escalates to a person.\nLogged to the ledger as ${e.id}, awaiting human approval.`);
    });

  return server;
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => res.send("Septon demo connector v4 is running. MCP endpoints: /mcp/claude · /mcp/chatgpt · /mcp/copilot · /mcp/gemini · Ledger: /api/ledger · Threads: /api/threads"));
app.get("/api/ledger", (req, res) => res.json({ count: BASE_COUNT + ledger.length, entries: ledger }));
app.post("/api/reset", (req, res) => { ledger = []; seq = 1; Object.keys(drafts).forEach((k) => delete drafts[k]); res.json({ ok: true }); });
app.get("/api/draft", (req, res) => res.json({ drafts }));
app.get("/api/threads", (req, res) => {
  const t = {};
  ledger.forEach((e) => { const k = e.topic || "General"; (t[k] = t[k] || { topic: k, entries: [], tools: new Set() }).entries.push(e); t[k].tools.add(e.source); });
  res.json(Object.values(t).map((x) => ({ topic: x.topic, count: x.entries.length, tools: [...x.tools], entries: x.entries })));
});

app.post(["/mcp", "/mcp/:tool"], async (req, res) => {
  try {
    const server = buildServer((req.params.tool || "claude").toLowerCase());
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
app.get(["/mcp", "/mcp/:tool"], (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
app.delete(["/mcp", "/mcp/:tool"], (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Septon connector v4 listening on ${PORT}`));
