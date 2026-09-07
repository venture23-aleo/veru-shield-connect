import { CheckCircle, Lock, Eye, EyeSlash } from "@phosphor-icons/react";
import { store } from "../lib/store.js";
import { modeLabel, networkLabel } from "./WorkspaceShell.js";

/**
 * The privacy trade-offs of the CURRENT connection, stated plainly (the
 * hackathon rule: be precise about what is and isn't private). Demo mode
 * also lets you pick how the simulated prover behaves.
 */
export function TradeoffsPanel() {
  const cfg = store.config!;
  const demo = cfg.mode === "demo";
  const wallet = cfg.mode === "wallet";
  const pool = cfg.mode === "pool";
  const provingMode = cfg.provingMode ?? "self";

  const rows: { label: string; value: string; tone: "ok" | "warn" | "muted" }[] = [
    { label: "Who proves", value: wallet ? `${cfg.walletId ?? "the wallet"} — the wallet holds the keys and proves` : pool ? (cfg.poolLocal ? "this app, mock prover on devnet" : `this app's prover (${cfg.provingUrl ?? "not set"})`) : demo ? "simulated in this browser" : "no proof — dev helper", tone: "muted" },
    { label: "Who submits", value: demo ? "nobody — simulated" : "your own account: the payer is public on-chain by design (Arch 1)", tone: demo ? "muted" : "warn" },
    { label: "Recipient of a payment", value: pool || wallet ? "hidden from the second payment on; the first opens a channel and names them in calldata" : demo ? "hidden (simulated)" : "visible — dev mode", tone: pool || wallet ? "ok" : demo ? "muted" : "warn" },
    { label: "Amount", value: pool || wallet ? "hidden — encrypted note" : demo ? "hidden (simulated)" : "n/a", tone: pool || wallet ? "ok" : "muted" },
    { label: "Message content", value: "hidden — ChaCha20-Poly1305, only the two lanes' keys open it", tone: "ok" },
    { label: "That a message was sent", value: "public — pool address, helper address, payload size, timestamp", tone: "warn" },
    { label: "Message lanes", value: pool ? "pool channel keys, derived from your viewing key" : "address-derived pair lanes — anyone who guesses the pair can derive the key; invites stay confidential", tone: pool ? "ok" : "warn" },
    { label: "Auditor", value: "STRK20 escrows viewing keys: an auditor under lawful process can read history", tone: "warn" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-8 lg:px-10 lg:py-10">
      <div className="w-full">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="label-caps text-primary">What this connection gives you</span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">Privacy trade-offs</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Read for {modeLabel()} on {networkLabel()}. Nothing here is a promise the chain doesn't keep.
            </p>
          </div>
          <span className="mono-sm shrink-0 rounded-full bg-surface-low px-2.5 py-1 text-primary">{networkLabel()}</span>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-lowest p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="label-caps text-muted-foreground">{r.label}</span>
                {r.tone === "ok" ? <EyeSlash size={14} className="text-primary" aria-hidden="true" /> : r.tone === "warn" ? <Eye size={14} className="text-warn" aria-hidden="true" /> : <Lock size={14} className="text-muted-foreground" aria-hidden="true" />}
              </div>
              <span className={`text-sm ${r.tone === "ok" ? "text-foreground" : r.tone === "warn" ? "text-warn" : "text-muted-foreground"}`}>{r.value}</span>
            </div>
          ))}
        </div>

        {demo && (
          <>
            <h2 className="label-caps mb-3 text-muted-foreground">Demo · simulated proving</h2>
            <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Choice selected={provingMode === "hosted"} title="Fast (as a hosted prover)" tag="~4 s" body="Simulates a remote prover: quick, but a real one sees the witness before the proof wraps it." onClick={() => store.updateConnection({ provingMode: "hosted", provingSeconds: 4 })} />
              <Choice selected={provingMode === "self"} title="Honest (as the app's own prover)" tag="~29 s" body="Simulates proving on your side: the measured mainnet latency. Nothing leaves the device." onClick={() => store.updateConnection({ provingMode: "self", provingSeconds: 29 })} />
            </div>
          </>
        )}
        {!demo && (
          <p className="text-sm text-muted-foreground">
            Real connections take their proving and submission from Settings → Connection. Sender anonymity is not claimed: dropping it removes the paymaster dependency, and makes the claim that survives — who was paid, and how much — one this app can defend.
          </p>
        )}
      </div>
    </div>
  );
}

function Choice({ selected, title, tag, body, onClick }: { selected: boolean; title: string; tag: string; body: string; onClick: () => void }) {
  return (
    <button type="button" className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${selected ? "active-top-rail border-primary/50 bg-surface-high" : "border-border bg-surface-lowest hover:bg-surface-low"}`} onClick={onClick}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary" : "border-outline"}`}>
            {selected && <CheckCircle size={12} weight="fill" className="text-on-primary" />}
          </span>
          <strong className={selected ? "text-primary" : "text-foreground"}>{title}</strong>
        </div>
        <span className="mono-sm rounded bg-surface-mid px-1.5 py-0.5 text-secondary">{tag}</span>
      </div>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
    </button>
  );
}
