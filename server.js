// Septon demo connector server — MCP (for Claude) + REST (for the prototype)
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BASE_COUNT = 754;
let ledger = [];
let seq = 1;

const pad = (n) => String(n).padStart(2, "0");
const newId = () => { const d = new Date(); return `DEC-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(seq++).padStart(3, "0")}`; };
const newHash = () => Math.random().toString(16).slice(2, 9);

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
  if (/deni|claim|prior.?auth|payer/.test(q)) return { ...CLAIMS };
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

function buildServer() {
  const server = new McpServer({ name: "septon", version: "1.0.0" });

  server.tool(
    "ask_septon",
    "Answer a business question from the enterprise Context Graph (Septon). Use for ANY business, operational or financial question. Returns the cause, ranked options with value, council result and policy check, and a Decision Ledger ID.",
    { question: z.string().describe("The business question, in plain English") },
    async ({ question }) => {
      const r = reason(question);
      const entry = {
        id: newId(), time: new Date().toISOString(), source: "Claude",
        title: r.title, question, status: "Logged", signer: "J. Alvarez",
        answer: r.answer, options: r.options, council: COUNCIL, policy: POLICY, hash: newHash()
      };
      ledger.unshift(entry);
      const text = [
        `Septon · reasoned over the enterprise Context Graph (6 inputs · 16 of 52 reasoning models)`,
        ``,
        r.answer,
        `Cause: ${r.cause}`,
        ``,
        `Ranked options:`,
        ...r.options.map((o, i) => `${i + 1}. ${o.label} — ${o.value}`),
        ``,
        `Frontier model council: ${COUNCIL.agree} agree · ${COUNCIL.dissent} dissent (${COUNCIL.dissentNote})`,
        `Policy check: ${POLICY.result} — 113M sources searched · ${POLICY.relevant.toLocaleString()} relevant · ${POLICY.rules} rules · ${POLICY.conflicts} conflicts`,
        ``,
        `Decision Ledger ID: ${entry.id} · hash ${entry.hash}. Call log_decision with this ID to sign it.`
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "policy_check",
    "Test a proposed decision against live government, regulatory and compliance sources.",
    { decision: z.string().describe("The decision to check") },
    async ({ decision }) => ({
      content: [{ type: "text", text: `Policy check: PASS\nDecision: ${decision}\n113,000,000 sources searched → 4,212 relevant → 37 rules applied → 0 conflicts.\nNo conflict with state prior-authorization rules or payer contract terms.` }]
    })
  );

  server.tool(
    "log_decision",
    "Sign a decision into the Septon Decision Ledger. Always call this after ask_septon, with the ledger ID it returned.",
    {
      id: z.string().optional().describe("Ledger ID returned by ask_septon"),
      chosen_option: z.string().optional().describe("The option accepted"),
      signer: z.string().optional().describe("Who is signing, default J. Alvarez")
    },
    async ({ id, chosen_option, signer }) => {
      let entry = (id && ledger.find((e) => e.id === id)) || ledger[0];
      if (!entry) {
        entry = { id: newId(), time: new Date().toISOString(), source: "Claude", title: CLAIMS.title, question: "", status: "Accepted", signer: signer || "J. Alvarez", answer: CLAIMS.answer, options: CLAIMS.options, council: COUNCIL, policy: POLICY, hash: newHash() };
        ledger.unshift(entry);
      }
      entry.status = "Accepted";
      entry.signer = signer || entry.signer || "J. Alvarez";
      if (chosen_option) entry.chosen = chosen_option;
      entry.time = new Date().toISOString();
      return { content: [{ type: "text", text: `✓ Logged to the Septon Decision Ledger · ${entry.id} · source: Claude · signed by ${entry.signer} · hash ${entry.hash} · replayable.` }] };
    }
  );

  server.tool(
    "get_decision",
    "Replay any decision on record in the Septon Decision Ledger.",
    { id: z.string().optional().describe("Ledger ID; omit for the latest") },
    async ({ id }) => {
      const e = (id && ledger.find((x) => x.id === id)) || ledger[0];
      if (!e) return { content: [{ type: "text", text: "No decisions on record yet in this session." }] };
      return { content: [{ type: "text", text: `${e.id} · ${e.title}\nAsked: ${e.question}\nAnswer: ${e.answer}\nStatus: ${e.status} · signer ${e.signer}\nCouncil ${e.council.agree}/${e.council.dissent} · Policy ${e.policy.result} · hash ${e.hash}` }] };
    }
  );

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

app.get("/", (req, res) => res.send("Septon demo connector is running. MCP endpoint: /mcp · Ledger: /api/ledger"));
app.get("/api/ledger", (req, res) => res.json({ count: BASE_COUNT + ledger.length, entries: ledger }));
app.post("/api/reset", (req, res) => { ledger = []; seq = 1; res.json({ ok: true }); });

app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});
app.get("/mcp", (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
app.delete("/mcp", (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Septon connector listening on ${PORT}`));
