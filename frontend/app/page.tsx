"use client";

import { FormEvent, useEffect, useState } from "react";

type QType = "noul" | "choice" | "score";

type OptionProb = { option: string; description: string | null; probability: number };

type DecideResponse = {
  type: QType;
  decision: string;
  probabilities: OptionProb[];
  score: number | null;
  p_true: number | null;
  confidence: number;
  answer_confidence: number;
  act_probability: number | null;
  usage: Record<string, unknown>;
  meta: Record<string, unknown>;
  raw: Record<string, unknown>;
};

type Health = {
  status: string;
  model: string;
  backbone: string;
  params: string;
  device: string;
  gpu: string | null;
  dtype: string;
  max_len: number;
  head_max_len: number;
  laya_version: string | null;
};

type Row = { key: string; desc: string };

const TYPE_LABELS: Record<QType, string> = { noul: "Yes / No", choice: "Choice", score: "Score" };

const SAMPLE_STATE =
  "Hi, we were billed twice for March. Please refund the duplicate today or we will cancel our plan.";

const EXAMPLES: Record<QType, { instructions: string; rows: Row[] }> = {
  noul: {
    instructions: "Does the user threaten to cancel or leave?",
    rows: [
      { key: "true", desc: "" },
      { key: "false", desc: "" },
    ],
  },
  choice: {
    instructions: "Which department should handle this request?",
    rows: [
      { key: "billing", desc: "invoices, payments, refunds" },
      { key: "technical", desc: "bugs, outages, system errors" },
      { key: "sales", desc: "pricing, new contracts" },
      { key: "other", desc: "everything else" },
    ],
  },
  score: {
    instructions: "How urgent is this request?",
    rows: [
      { key: "not urgent", desc: "" },
      { key: "soon", desc: "" },
      { key: "critical deadline or blocking issue", desc: "" },
    ],
  },
};

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export default function Home() {
  const [qtype, setQtype] = useState<QType>("choice");
  const [state, setState] = useState(SAMPLE_STATE);
  const [instructions, setInstructions] = useState(EXAMPLES.choice.instructions);
  const [rows, setRows] = useState<Row[]>(EXAMPLES.choice.rows);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setHealth)
      .catch(() => setHealthErr(true));
  }, []);

  function switchType(t: QType) {
    setQtype(t);
    setInstructions(EXAMPLES[t].instructions);
    setRows(EXAMPLES[t].rows);
    setResult(null);
    setError(null);
  }

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  function buildCriteria() {
    if (qtype === "choice") {
      return Object.fromEntries(
        rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.desc.trim() || null]),
      );
    }
    if (qtype === "score") return rows.map((r) => r.key.trim()).filter(Boolean);
    const crit: Record<string, string> = {};
    for (const r of rows) if (r.desc.trim()) crit[r.key] = r.desc.trim();
    return Object.keys(crit).length ? crit : undefined;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, question: { type: qtype, instructions, criteria: buildCriteria() } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const d = body?.detail;
        throw new Error(
          Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join("; ") : d || `Request failed (${res.status})`,
        );
      }
      setResult(body as DecideResponse);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const top = result ? Math.max(...result.probabilities.map((p) => p.probability)) : 0;

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Laya Decision</h1>
          <p className="sub">One state, one typed question, one calibrated answer.</p>
        </div>
        <div className={`status ${health ? "ok" : healthErr ? "bad" : ""}`}>
          <span className="dot" />
          {health
            ? `${health.model} · ${health.params} · ${health.device}${health.gpu ? ` (${health.gpu})` : ""} · ${health.dtype}`
            : healthErr
              ? "Backend unreachable on :8010"
              : "Connecting…"}
        </div>
      </header>

      <div className="grid">
        <form className="card" onSubmit={onSubmit}>
          <label className="lbl" htmlFor="state">State</label>
          <textarea
            id="state"
            rows={6}
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="The text the decision is about: an email, ticket, message, JSON…"
            required
          />

          <span className="lbl">Question type</span>
          <div className="seg" role="tablist">
            {(Object.keys(TYPE_LABELS) as QType[]).map((t) => (
              <button
                type="button"
                key={t}
                role="tab"
                aria-selected={qtype === t}
                className={qtype === t ? "on" : ""}
                onClick={() => switchType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <label className="lbl" htmlFor="ins">Question</label>
          <input id="ins" value={instructions} onChange={(e) => setInstructions(e.target.value)} required />

          <span className="lbl">
            {qtype === "choice" ? "Options" : qtype === "score" ? "Levels (lowest first)" : "Answer descriptions (optional)"}
          </span>
          <div className="rows">
            {rows.map((r, i) => (
              <div className="row" key={i}>
                {qtype === "noul" ? (
                  <span className="tag">{r.key === "true" ? "yes" : "no"}</span>
                ) : (
                  <input
                    aria-label={qtype === "choice" ? "Option key" : `Level ${i}`}
                    placeholder={qtype === "choice" ? "key" : `level ${i}`}
                    value={r.key}
                    onChange={(e) => updateRow(i, "key", e.target.value)}
                  />
                )}
                {qtype !== "score" && (
                  <input
                    aria-label="Description"
                    placeholder={
                      qtype === "noul"
                        ? r.key === "true"
                          ? "yes, the statement holds"
                          : "no, the statement does not hold"
                        : "description (optional)"
                    }
                    value={r.desc}
                    onChange={(e) => updateRow(i, "desc", e.target.value)}
                  />
                )}
                {qtype !== "noul" && rows.length > 2 && (
                  <button
                    type="button"
                    className="x"
                    aria-label="Remove"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {qtype !== "noul" && (
              <button type="button" className="add" onClick={() => setRows((rs) => [...rs, { key: "", desc: "" }])}>
                + Add {qtype === "choice" ? "option" : "level"}
              </button>
            )}
          </div>

          <button className="go" type="submit" disabled={loading || !health}>
            {loading ? "Deciding…" : "Decide"}
          </button>
        </form>

        <section className="card out" aria-live="polite">
          {error && <div className="err">{error}</div>}
          {!result && !error && <p className="empty">The answer and its probability scores appear here.</p>}
          {result && (
            <>
              <span className="lbl">Answer</span>
              <div className="answer">{result.decision}</div>
              <div className="conf">
                {pct(result.answer_confidence)} answer confidence
                {result.score !== null && (
                  <> · expected score {result.score.toFixed(3)} / {result.probabilities.length - 1}</>
                )}
                {result.p_true !== null && <> · P(yes) = {result.p_true.toFixed(4)}</>}
              </div>

              <span className="lbl">Probability distribution</span>
              <ul className="bars">
                {result.probabilities.map((p) => (
                  <li key={p.option} className={p.probability === top ? "best" : ""}>
                    <div className="bar-head">
                      <span>
                        <b>{p.option}</b>
                        {p.description && <em> — {p.description}</em>}
                      </span>
                      <span className="num">{p.probability.toFixed(4)}</span>
                    </div>
                    <div className="track">
                      <div className="fill" style={{ width: pct(p.probability) }} />
                    </div>
                  </li>
                ))}
              </ul>

              <span className="lbl">Metadata</span>
              <dl className="meta">
                <dt>answer_confidence</dt>
                <dd>
                  {result.answer_confidence.toFixed(4)} <small>max(p), the calibrated quantity</small>
                </dd>
                <dt>confidence</dt>
                <dd>
                  {result.confidence.toFixed(4)}{" "}
                  <small>{result.type === "noul" ? "max(p)" : "1 − normalized entropy (not calibrated)"}</small>
                </dd>
                <dt>act_probability</dt>
                <dd>
                  {result.act_probability?.toFixed(4) ?? "—"} <small>no usable signal yet, per model card</small>
                </dd>
                <dt>temperature</dt>
                <dd>
                  {String(result.meta.temperature)} <small>bucket {String(result.meta.temperature_bucket)}</small>
                </dd>
                <dt>latency</dt>
                <dd>
                  {String(result.meta.latency_ms)} ms <small>on {String(result.meta.device)}</small>
                </dd>
                <dt>tokens</dt>
                <dd>
                  {String(result.usage.input_tokens)} input · {String(result.usage.state_tokens)} state
                  {result.usage.truncated ? (
                    <small className="warn"> truncated, {String(result.usage.state_tokens_dropped)} state tokens dropped</small>
                  ) : null}
                </dd>
                <dt>model</dt>
                <dd>{String(result.meta.model)}</dd>
              </dl>

              <details>
                <summary>Raw model output</summary>
                <pre>{JSON.stringify(result.raw, null, 2)}</pre>
              </details>
            </>
          )}
        </section>
      </div>

      <footer className="foot">
        convaiinnovations/laya · ModernBERT-large + decision head · English, 512-token context. Shipped probabilities are
        over-confident until temperatures are refit on your own data.
      </footer>
    </main>
  );
}
