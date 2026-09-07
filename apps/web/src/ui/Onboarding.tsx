import { ArrowRight, CheckCircle, Lock, Warning, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { randomFelt, store } from "../lib/store.js";
import type { Contact } from "../lib/contacts.js";
import { WorkspaceShell, type AppRoute } from "./WorkspaceShell.js";

/**
 * Compliance disclosure is mandatory and non-skippable (UX §3 / 12-client-and-ui).
 * Layout matches Stitch onboarding screens inside the VeruShield Connect workspace shell.
 */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [route, setRoute] = useState<AppRoute>("compliance");
  const [complianceAck, setComplianceAck] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [permanenceAck, setPermanenceAck] = useState(false);
  const [metadataAck, setMetadataAck] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [keys, setKeys] = useState<{
    viewingKey: string;
    accountAddress: string;
    contacts: Contact[];
  } | null>(null);
  const [provingMode, setProvingMode] = useState<"hosted" | "self">("hosted");
  const [submissionMode, setSubmissionMode] = useState<"paymaster" | "direct">("paymaster");
  const [registering, setRegistering] = useState(false);
  const disclosureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === 0) setRoute("compliance");
    else if (step === 2) setRoute("tradeoffs");
  }, [step]);

  useEffect(() => {
    const el = disclosureRef.current;
    if (!el || step !== 0) return;
    const check = () => {
      // Fits without scroll → unlock immediately; otherwise require end of scroll.
      if (el.scrollHeight - el.clientHeight <= 8) {
        setScrolledToEnd(true);
        return;
      }
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 8) setScrolledToEnd(true);
    };
    check();
    el.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [step]);

  const finish = (k: NonNullable<typeof keys>) => {
    setRegistering(true);
    store.completeOnboarding(
      {
        mode: "demo",
        viewingKey: k.viewingKey,
        accountAddress: k.accountAddress,
        provingSeconds: provingMode === "self" ? 29 : 4,
        provingMode,
        submissionMode,
      },
      k.contacts
    );
  };

  const handleRoute = (r: AppRoute) => {
    if (r === "compliance" && step <= 1) {
      setRoute("compliance");
      setStep(0);
      return;
    }
    if (r === "tradeoffs" && keys) {
      setRoute("tradeoffs");
      setStep(2);
      return;
    }
    if (r === "compliance") setRoute("compliance");
  };

  const locked: AppRoute[] = ["conversations", "settings"];
  if (!keys) locked.push("tradeoffs");

  return (
    <WorkspaceShell
      route={route}
      onRoute={handleRoute}
      identity={keys?.accountAddress ?? null}
      lockedRoutes={locked}
    >
      <main
        ref={disclosureRef}
        className="min-h-0 flex-1 overflow-y-auto bg-surface"
        aria-label={step === 0 ? "Compliance disclosure" : undefined}
      >
        {step === 0 && (
          <ComplianceStep
            scrolledToEnd={scrolledToEnd}
            complianceAck={complianceAck}
            permanenceAck={permanenceAck}
            metadataAck={metadataAck}
            setComplianceAck={setComplianceAck}
            setPermanenceAck={setPermanenceAck}
            setMetadataAck={setMetadataAck}
            onContinue={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <ViewingKeyStep
            keys={keys}
            setKeys={setKeys}
            restoreOpen={restoreOpen}
            setRestoreOpen={setRestoreOpen}
            restoreText={restoreText}
            setRestoreText={setRestoreText}
            restoreError={restoreError}
            setRestoreError={setRestoreError}
            onContinue={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && keys && (
          <TradeoffsStep
            provingMode={provingMode}
            setProvingMode={setProvingMode}
            submissionMode={submissionMode}
            setSubmissionMode={setSubmissionMode}
            registering={registering}
            contactCount={keys.contacts.length}
            onFinish={() => finish(keys)}
            onReset={() => {
              setProvingMode("hosted");
              setSubmissionMode("paymaster");
            }}
          />
        )}
      </main>
    </WorkspaceShell>
  );
}

function ComplianceStep({
  scrolledToEnd,
  complianceAck,
  permanenceAck,
  metadataAck,
  setComplianceAck,
  setPermanenceAck,
  setMetadataAck,
  onContinue,
}: {
  scrolledToEnd: boolean;
  complianceAck: boolean;
  permanenceAck: boolean;
  metadataAck: boolean;
  setComplianceAck: (fn: (v: boolean) => boolean) => void;
  setPermanenceAck: (fn: (v: boolean) => boolean) => void;
  setMetadataAck: (fn: (v: boolean) => boolean) => void;
  onContinue: () => void;
}) {
  const canContinue = scrolledToEnd && complianceAck && permanenceAck && metadataAck;

  return (
    <div className="flex min-h-full w-full flex-col px-6 py-6 lg:px-10 lg:py-8">
      <div className="mb-6 flex w-full flex-col items-start justify-between gap-2 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
          <span className="label-caps text-primary tracking-widest">
            01 / Protocol Initialization · Mandatory Disclosure
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="mono-sm rounded-full bg-surface-low px-2.5 py-0.5 text-secondary">
            CIRCUIT-V0.1 ATTRIBUTED
          </span>
          <span className="hidden mono-sm rounded-full bg-surface-low px-2.5 py-0.5 text-foreground sm:inline">
            ESCROW REGION: CH-ZURICH-TEE
          </span>
        </div>
      </div>

      <div className="flex w-full flex-1 flex-col rounded-xl bg-surface-lowest shadow-2xl">
        <div className="optical-rail rounded-t-xl" />
        <div className="flex flex-1 flex-col p-6 sm:p-8 lg:p-10">
          <div className="flex w-full flex-col items-center text-center lg:items-start lg:text-left">
            <div className="relative mb-8 w-max">
              <img
                src="/verushield-logo.svg"
                alt="VeruShield Connect"
                width={96}
                height={96}
                className="h-24 w-24 rounded-2xl shadow-lg"
                draggable={false}
              />
              <div className="absolute -right-4 -bottom-3 z-10 flex w-max items-center gap-1.5 whitespace-nowrap rounded bg-surface-highest px-2 py-1 mono-sm text-secondary shadow-md">
                <Lock size={13} weight="bold" className="shrink-0 text-primary" aria-hidden="true" />
                <span>ESCROW M-OF-N</span>
              </div>
            </div>
            <span className="label-caps mb-2 tracking-widest text-secondary">
              Cryptographic Escrow Architecture
            </span>
            <h1 className="mb-4 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10 lg:text-[36px] lg:leading-[44px]">
              Your messages are private from everyone{" "}
              <span className="text-primary">except a designated auditor</span>
            </h1>
            <p className="max-w-4xl text-base leading-relaxed text-muted-foreground lg:text-lg">
              VeruShield Connect uses zero-knowledge validity proofs on Starknet to conceal
              transaction senders, recipients, and amounts from pool participants and relayers.
              Incoming and outgoing message payloads are also encrypted to an auditor public key
              held in multi-institution cryptographic escrow for lawful process.
            </p>
          </div>

          <div className="mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            <DomainCard
              domain="Domain 01"
              title="Relayers & Peers"
              badge="SHIELDED"
              badgeTone="primary"
              body="Zero-knowledge guarantee. Third-party nodes cannot inspect encrypted packets, discover graph relationships, or reconstruct sender addresses."
              foot="STARK Validity Verified"
            />
            <DomainCard
              domain="Domain 02"
              title="Pool Ledger"
              badge="UTXO ROOT"
              badgeTone="secondary"
              body="Shielded UTXO trees. Starknet contract state changes reveal no directional correlation between inputs, outputs, or balance redistributions."
              foot="Merkle Accumulator"
              footTone="secondary"
            />
            <DomainCard
              domain="Domain 03"
              title="Auditor Escrow"
              badge="LAWFUL"
              badgeTone="tertiary"
              body="Threshold Shamir sharing. Designated trustees can reconstruct viewing keys under lawful process and decrypt historic channel payloads."
              foot="Cryptographic Quorum Enforced"
              footTone="tertiary"
            />
          </div>

          <div className="mt-6 w-full rounded-lg border border-warn/40 bg-warn-bg p-4">
            <div className="mb-1 flex items-center gap-2">
              <Warning size={16} weight="fill" className="text-warn" aria-hidden="true" />
              <span className="label-caps text-warn">Legal Notice</span>
            </div>
            <p className="text-sm text-warn">
              <strong>
                This protocol is NOT suitable for anonymous whistleblowing or dissident
                communication.
              </strong>{" "}
              Auditor keys can be reconstructed to decrypt historic records. If your threat model
              includes an adversary who can compel the auditor, do not use this product.
            </p>
          </div>

          <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-surface-low p-4">
              <span className="label-caps text-muted-foreground">Quorum Timelock Execution</span>
              <p className="mt-1 text-sm text-muted-foreground">
                Mandatory challenge period before escrow reconstruction completes.
              </p>
            </div>
            <div className="rounded-lg bg-surface-low p-4">
              <span className="label-caps text-muted-foreground">Self-Sovereign Spend Key</span>
              <p className="mt-1 text-sm text-muted-foreground">
                Your local private spend key is never exposed to the escrow — only the viewing key.
              </p>
            </div>
          </div>

          <p className="mt-4 w-full text-sm leading-relaxed text-muted-foreground">
            Messages are written to WriteOnce storage: they cannot be edited or deleted. Observers
            can see that some message of a certain size was sent at a certain time; they cannot see
            who sent it, who received it, or what it said (except the auditor under lawful process).
          </p>

          {!scrolledToEnd && (
            <p className="sticky bottom-0 mt-4 bg-gradient-to-t from-surface-lowest via-surface-lowest to-transparent pt-8 text-center text-xs text-muted-foreground">
              Scroll to the end to unlock acknowledgment
            </p>
          )}

          <div className="mt-6 flex w-full flex-col gap-2.5">
            <AckRow
              checked={complianceAck}
              disabled={!scrolledToEnd}
              onToggle={() => setComplianceAck((v) => !v)}
              icon={<Lock size={16} className="text-primary" aria-hidden="true" />}
              label="I understand and accept this limitation — metadata and payloads are decryptable by designated auditors under lawful process."
            />
            <AckRow
              checked={permanenceAck}
              disabled={!scrolledToEnd}
              onToggle={() => setPermanenceAck((v) => !v)}
              icon={<Warning size={16} className="text-warn" aria-hidden="true" />}
              label="I understand messages are permanent — there is no delete."
            />
            <AckRow
              checked={metadataAck}
              disabled={!scrolledToEnd}
              onToggle={() => setMetadataAck((v) => !v)}
              icon={<WarningCircle size={16} className="text-muted-foreground" aria-hidden="true" />}
              label="I understand that “a message was sent” is public metadata."
            />
          </div>

          <button
            type="button"
            className="mt-6 mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-45 sm:w-auto"
            disabled={!canContinue}
            onClick={onContinue}
          >
            Continue to Trade-off Configuration
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  title,
  badge,
  badgeTone,
  body,
  foot,
  footTone = "primary",
}: {
  domain: string;
  title: string;
  badge: string;
  badgeTone: "primary" | "secondary" | "tertiary";
  body: string;
  foot: string;
  footTone?: "primary" | "secondary" | "tertiary";
}) {
  const badgeCls =
    badgeTone === "primary"
      ? "bg-surface-high text-primary"
      : badgeTone === "secondary"
        ? "bg-surface-high text-secondary"
        : "bg-surface-high text-tertiary-dim";
  const footCls =
    footTone === "primary"
      ? "text-primary"
      : footTone === "secondary"
        ? "text-secondary"
        : "text-tertiary-dim";
  return (
    <div className="flex flex-col justify-between rounded-lg bg-surface-low p-4 transition-colors hover:bg-surface-mid">
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-mid text-primary">
            <Lock size={16} aria-hidden="true" />
          </div>
          <span className={`label-caps rounded px-1.5 py-0.5 ${badgeCls}`}>{badge}</span>
        </div>
        <span className="label-caps mb-0.5 block text-muted-foreground">{domain}</span>
        <h4 className="mb-1.5 text-lg font-semibold leading-snug text-foreground">{title}</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="mt-3 flex items-center gap-1.5 pt-1">
        <span
          className={`h-1 w-1 rounded-full ${
            footTone === "primary"
              ? "bg-primary"
              : footTone === "secondary"
                ? "bg-secondary"
                : "bg-tertiary-dim"
          }`}
        />
        <span className={`mono-sm ${footCls}`}>{foot}</span>
      </div>
    </div>
  );
}

function AckRow({
  checked,
  disabled,
  onToggle,
  icon,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${
        checked ? "border-primary bg-primary/10" : "border-border bg-surface-low"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        className="mt-1 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="flex gap-2 text-sm text-foreground">
        {icon}
        {label}
      </span>
    </label>
  );
}

function ViewingKeyStep({
  keys,
  setKeys,
  restoreOpen,
  setRestoreOpen,
  restoreText,
  setRestoreText,
  restoreError,
  setRestoreError,
  onContinue,
  onBack,
}: {
  keys: { viewingKey: string; accountAddress: string; contacts: Contact[] } | null;
  setKeys: (k: { viewingKey: string; accountAddress: string; contacts: Contact[] }) => void;
  restoreOpen: boolean;
  setRestoreOpen: (v: boolean) => void;
  restoreText: string;
  setRestoreText: (v: string) => void;
  restoreError: string | null;
  setRestoreError: (v: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-full w-full flex-col px-6 py-8 lg:px-10 lg:py-10">
      <span className="label-caps text-primary">02 / Viewing Key</span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
        Your viewing key
      </h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Registration writes <code>SetViewingKey</code> on-chain. That key is{" "}
        <strong className="text-foreground">immutable</strong> — one-time, permanent for this
        identity. It is also your inbox and your backup.
      </p>

      <div className="mt-6 w-full rounded-xl border border-border bg-surface-lowest p-6 lg:p-8">
        {!keys && !restoreOpen && (
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary hover:opacity-90"
              onClick={() =>
                setKeys({ viewingKey: randomFelt(), accountAddress: randomFelt(), contacts: [] })
              }
            >
              Create a new key
            </button>
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-low px-4 py-2.5 text-foreground hover:bg-surface-mid"
              onClick={() => setRestoreOpen(true)}
            >
              Restore from backup
            </button>
          </div>
        )}
        {restoreOpen && !keys && (
          <div>
            <textarea
              className="mb-2 w-full rounded-lg border border-border bg-surface-low px-3 py-2 text-foreground placeholder:text-outline focus:border-primary"
              placeholder="Paste your backup JSON here"
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              rows={8}
            />
            {restoreError && <p className="mb-2 text-sm text-destructive">{restoreError}</p>}
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary hover:opacity-90"
              onClick={() => {
                try {
                  setKeys(store.restoreFromBackup(restoreText));
                  setRestoreError(null);
                } catch (e) {
                  setRestoreError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Restore
            </button>
          </div>
        )}
        {keys && (
          <div className="space-y-2">
            <p>
              <strong>Account:</strong>{" "}
              <code className="rounded bg-surface-high px-1.5 py-0.5 mono-sm text-secondary">
                {shorten(keys.accountAddress)}
              </code>
            </p>
            <p className="text-sm text-muted-foreground">
              Registration is bundled into your first real action — no separate transaction upfront.
            </p>
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary hover:opacity-90"
              onClick={onContinue}
            >
              Continue to defaults
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="mt-4 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        ← Back to disclosure
      </button>
    </div>
  );
}

function TradeoffsStep({
  provingMode,
  setProvingMode,
  submissionMode,
  setSubmissionMode,
  registering,
  contactCount,
  onFinish,
  onReset,
}: {
  provingMode: "hosted" | "self";
  setProvingMode: (v: "hosted" | "self") => void;
  submissionMode: "paymaster" | "direct";
  setSubmissionMode: (v: "paymaster" | "direct") => void;
  registering: boolean;
  contactCount: number;
  onFinish: () => void;
  onReset: () => void;
}) {
  const latency = provingMode === "hosted" ? "~4.0s" : "~29s";
  const leak = submissionMode === "paymaster" ? "Zero (Shielded)" : "Gas wallet visible";
  const ram = provingMode === "hosted" ? "Minimal (8% RAM)" : "High (WASM local)";

  return (
    <div className="flex min-h-full w-full flex-col px-6 py-8 lg:px-10 lg:py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="label-caps text-primary">03 / Architecture Preferences</span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
            Architecture & Cryptographic Trade-offs
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Choose your threat model. These are real trade-offs — not silent defaults. You can
            change them later in Privacy Settings.
          </p>
        </div>
        <span className="mono-sm shrink-0 rounded-full bg-surface-low px-2.5 py-1 text-primary">
          SYSTEM STATE: DETERMINISTIC
        </span>
      </div>

      <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-border bg-surface-lowest px-4 py-3">
        <SummaryChip
          label="Policy"
          value={
            provingMode === "hosted"
              ? "Hosted SGX + Relayer Batched"
              : "Local WASM + Relayer Batched"
          }
        />
        <SummaryChip label="Est. Proof Latency" value={latency} />
        <SummaryChip label="Mempool Origin Leak" value={leak} />
        <SummaryChip label="Local Compute" value={ram} />
      </div>

      <h2 className="label-caps mb-3 text-muted-foreground">Section 01 · Proving Architecture</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        <ChoiceCard
          selected={provingMode === "hosted"}
          title="Hosted Prover"
          tag="~4s · SGX"
          body="Remote ZK witness generation in an Intel SGX enclave. Low latency, zero battery impact. The proving service sees plaintext before proof wrap."
          onClick={() => setProvingMode("hosted")}
        />
        <ChoiceCard
          selected={provingMode === "self"}
          title="Self-hosted Prover"
          tag="28–35s · Airgap"
          body="Local browser WASM computation. High CPU/RAM, mathematical airgap — nothing leaves your device during proof generation."
          onClick={() => setProvingMode("self")}
        />
      </div>

      <h2 className="label-caps mb-3 text-muted-foreground">Section 02 · Transaction Submission</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        <ChoiceCard
          selected={submissionMode === "paymaster"}
          title="Paymaster Relay"
          tag="SHIELDED MEMPOOL"
          body="A third party submits proofs so your gas wallet address stays off the Starknet mempool origin."
          onClick={() => setSubmissionMode("paymaster")}
        />
        <ChoiceCard
          selected={submissionMode === "direct"}
          title="Direct Submit"
          tag="INDEPENDENT RPC"
          warn
          body="Faster / no third-party dependency. Your gas wallet address is permanently recorded on-chain with the transaction."
          onClick={() => setSubmissionMode("direct")}
        />
      </div>

      <h2 className="label-caps mb-3 text-muted-foreground">
        Section 03 · Calculated Cryptographic Data Path
      </h2>
      <div className="mb-8 grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-lowest p-4 md:grid-cols-4">
        {[
          ["Channel Payload", "ChaCha20-Poly1305 Memo"],
          ["ZK Witness Gen", provingMode === "hosted" ? "Enclave STARK" : "Local WASM STARK"],
          [
            "Batch Submit",
            submissionMode === "paymaster" ? "Zero Origin Address" : "Direct Gas Wallet",
          ],
          ["Starknet Distro", "L2 Block Finality"],
        ].map(([title, sub]) => (
          <div key={title} className="rounded-lg bg-surface-low p-3">
            <div className="label-caps text-muted-foreground">{title}</div>
            <div className="mono-sm mt-1 text-primary">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-lg border border-border bg-surface-low px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          Reset Defaults
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-on-primary hover:opacity-90 disabled:opacity-45"
          disabled={registering}
          onClick={onFinish}
        >
          {registering
            ? "Registering…"
            : contactCount > 0
              ? `Save & Restore ${contactCount} contact(s)`
              : "Save Architecture Preferences"}
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-caps text-muted-foreground">{label}</div>
      <div className="mono-sm mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

function ChoiceCard({
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
          : "border-border bg-surface-lowest hover:border-border-strong hover:bg-surface-low"
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

export function shorten(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}
