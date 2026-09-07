import { CheckCircle } from "@phosphor-icons/react";
import { store } from "../lib/store.js";

/** Post-onboarding trade-off editor (Stitch Trade-off Config route). */
export function TradeoffsPanel() {
  const cfg = store.config!;
  const provingMode = cfg.provingMode;
  const submissionMode = cfg.submissionMode;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-8 lg:px-10 lg:py-10">
      <div className="w-full">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="label-caps text-primary">Architecture Preferences</span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
              Architecture & Cryptographic Trade-offs
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Live defaults for this browser. Changes apply to the next batch send.
            </p>
          </div>
          <span className="mono-sm shrink-0 rounded-full bg-surface-low px-2.5 py-1 text-primary">
            SYSTEM STATE: DETERMINISTIC
          </span>
        </div>

        <h2 className="label-caps mb-3 text-muted-foreground">Section 01 · Proving Architecture</h2>
        <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Choice
            selected={provingMode === "hosted"}
            title="Hosted Prover"
            tag="~4s · SGX"
            body="Remote ZK witness generation. Faster start; proving service sees plaintext before proof wrap."
            onClick={() =>
              store.updateConnection({ provingMode: "hosted", provingSeconds: 4 })
            }
          />
          <Choice
            selected={provingMode === "self"}
            title="Self-hosted Prover"
            tag="28–35s · Airgap"
            body="Local browser WASM. Nothing leaves your device during proof generation."
            onClick={() =>
              store.updateConnection({ provingMode: "self", provingSeconds: 29 })
            }
          />
        </div>

        <h2 className="label-caps mb-3 text-muted-foreground">Section 02 · Transaction Submission</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Choice
            selected={submissionMode === "paymaster"}
            title="Paymaster Relay"
            tag="SHIELDED MEMPOOL"
            body="Third party submits so your gas wallet stays off the mempool origin."
            onClick={() => store.updateConnection({ submissionMode: "paymaster" })}
          />
          <Choice
            selected={submissionMode === "direct"}
            title="Direct Submit"
            tag="INDEPENDENT RPC"
            warn
            body="Your gas wallet address is permanently recorded on-chain with the transaction."
            onClick={() => store.updateConnection({ submissionMode: "direct" })}
          />
        </div>
      </div>
    </div>
  );
}

function Choice({
  selected,
  title,
  tag,
  body,
  warn,
  onClick,
}: {
  selected: boolean;
  title: string;
  tag: string;
  body: string;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "active-top-rail border-primary/50 bg-surface-high"
          : "border-border bg-surface-lowest hover:bg-surface-low"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full border ${
              selected ? "border-primary bg-primary" : "border-outline"
            }`}
          >
            {selected && <CheckCircle size={12} weight="fill" className="text-on-primary" />}
          </span>
          <strong className={selected ? "text-primary" : "text-foreground"}>{title}</strong>
        </div>
        <span
          className={`mono-sm rounded px-1.5 py-0.5 ${
            warn ? "bg-destructive/10 text-destructive" : "bg-surface-mid text-secondary"
          }`}
        >
          {tag}
        </span>
      </div>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
    </button>
  );
}
