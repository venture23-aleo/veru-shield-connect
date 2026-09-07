import {
  CheckCircle,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  Lightning,
  Lock,
  SignOut,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import {
  SEPOLIA_PRESET,
  isHex,
  listSncastAccounts,
  parseCredentialsPaste,
  probeConnection,
  type SncastAccount,
} from "../lib/presets.js";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

type SettingsTab = "connection" | "backup" | "session";

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-surface-lowest px-2.5 py-2 font-mono text-sm text-foreground placeholder:text-outline focus:border-primary";

/** Mode switcher + direct-mode connection details, with presets and a probe. */
function ConnectionEditor({ onSaved }: { onSaved: () => void }) {
  const cfg = store.config!;
  const envSigner = {
    address: (import.meta.env.VITE_DEV_SIGNER_ADDRESS as string | undefined) ?? "",
    key: (import.meta.env.VITE_DEV_SIGNER_KEY as string | undefined) ?? "",
  };
  const [mode, setMode] = useState<"demo" | "direct">(cfg.mode);
  const [rpcUrl, setRpcUrl] = useState(cfg.rpcUrl ?? SEPOLIA_PRESET.rpcUrl);
  const [helper, setHelper] = useState(
    cfg.helperAddress ?? (envSigner.address ? SEPOLIA_PRESET.helperAddress : "")
  );
  const [account, setAccount] = useState(
    cfg.mode === "direct" ? cfg.accountAddress : envSigner.address
  );
  const [key, setKey] = useState(cfg.accountKey ?? envSigner.key);
  const [identity, setIdentity] = useState(cfg.identityAddress ?? "");
  const [showKey, setShowKey] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | "checking" | null>(null);
  const [saved, setSaved] = useState(false);
  const [keyPub, setKeyPub] = useState<string | null>(null);
  const [fileAccounts, setFileAccounts] = useState<SncastAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    const k = key.trim();
    if (!isHex(k) || k.length < 20) {
      setKeyPub(null);
      return;
    }
    void import("starknet").then(({ ec }) => {
      if (cancelled) return;
      try {
        setKeyPub(ec.starkCurve.getStarkKey(k));
      } catch {
        setKeyPub(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const applyPreset = () => {
    setRpcUrl(SEPOLIA_PRESET.rpcUrl);
    setHelper(SEPOLIA_PRESET.helperAddress);
    if (!account) setAccount(SEPOLIA_PRESET.accountAddress);
    setProbe(null);
  };

  const applyPaste = (text: string) => {
    const creds = parseCredentialsPaste(text, account);
    if (!creds) {
      setPasteNote(
        "Couldn't recognize that — paste your sncast accounts JSON, an app backup, or a bare 0x… key."
      );
      return;
    }
    if (creds.accountAddress) setAccount(creds.accountAddress);
    if (creds.privateKey) setKey(creds.privateKey);
    setPasteNote(
      `imported from ${creds.source}${creds.privateKey ? " (address + key)" : " (address only)"}`
    );
    setFileAccounts(listSncastAccounts(text));
    setPasteOpen(false);
    setProbe(null);
  };

  const signerAddr = account.trim();
  const chosenIdentity = identity.trim() || signerAddr;

  const runProbe = async () => {
    setProbe("checking");
    setProbe(
      await probeConnection(rpcUrl.trim(), helper.trim(), account.trim(), key.trim() || undefined)
    );
  };

  const fieldOk = {
    helper: isHex(helper),
    account: isHex(account),
    key: isHex(key),
  };
  const canSave =
    mode === "demo" || (rpcUrl.trim() !== "" && fieldOk.helper && fieldOk.account && fieldOk.key);

  const save = () => {
    if (mode === "demo") {
      store.updateConnection({ mode: "demo" });
    } else {
      store.updateConnection({
        mode: "direct",
        rpcUrl: rpcUrl.trim(),
        helperAddress: helper.trim(),
        accountAddress: account.trim(),
        accountKey: key.trim(),
        identityAddress: identity.trim() || undefined,
      });
    }
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onSaved();
    }, 900);
  };

  const current = store.config!;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface-low px-3 py-2.5">
        <div className="label-caps text-muted-foreground">Live session</div>
        <p className="mt-1 mono-sm text-foreground">
          Mode <strong className="text-primary">{current.mode}</strong>
          {current.mode === "direct" && (
            <>
              {" "}
              · signer <code className="text-secondary">{shorten(current.accountAddress)}</code> ·
              identity{" "}
              <code className="text-secondary">
                {shorten(current.identityAddress || current.accountAddress)}
              </code>
            </>
          )}
        </p>
      </div>

      <div>
        <div className="label-caps mb-2 text-muted-foreground">Backend mode</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["demo", "Demo", "Simulated pool in this browser — nothing leaves your machine"],
              ["direct", "Direct", "Real helper contract over RPC — testnet dev mode"],
            ] as const
          ).map(([value, title, desc]) => (
            <button
              key={value}
              type="button"
              className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                mode === value
                  ? "active-top-rail border-primary/50 bg-surface-high"
                  : "border-border bg-surface-lowest hover:bg-surface-low"
              }`}
              onClick={() => {
                setMode(value);
                setProbe(null);
              }}
            >
              <strong className={mode === value ? "text-primary" : "text-foreground"}>{title}</strong>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === "direct" && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-lowest p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-mid px-3 py-2 text-sm hover:border-primary/50"
              onClick={applyPreset}
            >
              <Lightning size={14} aria-hidden="true" />
              {SEPOLIA_PRESET.label}
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-mid hover:text-foreground"
              onClick={() => setPasteOpen(!pasteOpen)}
            >
              Paste credentials…
            </button>
          </div>

          {envSigner.key && (
            <p className="text-xs text-muted-foreground">
              Dev signer prefilled from <code>.env.local</code> (
              <code>{shorten(envSigner.address)}</code>).
            </p>
          )}
          {pasteOpen && (
            <textarea
              className={`${fieldClass} mt-0`}
              rows={3}
              placeholder="Paste sncast accounts JSON, an app backup, or a bare 0x… private key"
              onChange={(e) => e.target.value.trim() && applyPaste(e.target.value)}
            />
          )}
          {pasteNote && <p className="text-xs text-muted-foreground">{pasteNote}</p>}

          <label className="text-sm">
            <span className="label-caps text-muted-foreground">RPC URL</span>
            <input className={fieldClass} value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="label-caps text-muted-foreground">Helper contract</span>
            <input
              className={`${fieldClass} ${helper && !fieldOk.helper ? "border-destructive" : ""}`}
              placeholder="0x…"
              value={helper}
              onChange={(e) => setHelper(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="label-caps text-muted-foreground">Account address</span>
            <input
              className={`${fieldClass} ${account && !fieldOk.account ? "border-destructive" : ""}`}
              placeholder="0x…"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Must be the account the helper was deployed with (its pool).
            </span>
          </label>
          <label className="text-sm">
            <span className="label-caps text-muted-foreground">Account private key</span>
            <span className="mt-1 flex items-stretch gap-2">
              <input
                className={`${fieldClass} mt-0 flex-1 ${key && !fieldOk.key ? "border-destructive" : ""}`}
                type={showKey ? "text" : "password"}
                placeholder="0x… (testnet only — stored in this browser)"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2.5 text-sm text-muted-foreground hover:bg-surface-mid"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? "Hide private key" : "Show private key"}
              >
                {showKey ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </span>
            {keyPub && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Public key: <code>{shorten(keyPub)}</code>
              </span>
            )}
          </label>

          {fileAccounts.length > 1 && (
            <div className="text-sm">
              <span className="label-caps text-muted-foreground">Who are you in this browser?</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {fileAccounts.map((a) => {
                  const selected =
                    isHex(chosenIdentity) &&
                    isHex(a.address) &&
                    BigInt(chosenIdentity) === BigInt(a.address);
                  return (
                    <button
                      key={a.name}
                      type="button"
                      className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "bg-primary font-semibold text-on-primary"
                          : "border border-border hover:border-primary/50"
                      }`}
                      onClick={() => {
                        const isSigner =
                          isHex(signerAddr) && BigInt(a.address) === BigInt(signerAddr);
                        setIdentity(isSigner ? "" : a.address);
                        setProbe(null);
                      }}
                    >
                      {a.name} <code className="ml-1">{shorten(a.address)}</code>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="text-sm">
            <span className="label-caps text-muted-foreground">Messaging identity (optional)</span>
            <input
              className={fieldClass}
              placeholder="0x… — leave empty to use the account address"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-border bg-surface-mid px-3 py-2 text-sm hover:border-primary/50 disabled:opacity-45"
              onClick={() => void runProbe()}
              disabled={!fieldOk.helper || !rpcUrl}
            >
              Test connection
            </button>
            {probe === "checking" && (
              <span className="mono-sm text-muted-foreground">checking…</span>
            )}
            {probe && probe !== "checking" && (
              <span className={`mono-sm ${probe.ok ? "text-ok" : "text-destructive"}`}>
                {probe.detail}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary hover:opacity-90 disabled:opacity-45"
          disabled={!canSave}
          onClick={save}
        >
          Save & reconnect
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-ok">
            <CheckCircle size={14} aria-hidden="true" />
            connected ({mode})
          </span>
        )}
      </div>
    </div>
  );
}

function BackupPanel() {
  const [copied, setCopied] = useState(false);
  const cfg = store.config!;

  const download = () => {
    const blob = new Blob([store.backupJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "verushield-connect-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface-lowest p-4">
        <div className="flex items-start gap-2">
          <Lock size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 className="font-semibold text-foreground">Key backup</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The backup holds your viewing key and contacts. Message history is rebuilt from the
              chain by sync — it is not included in the file.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 font-semibold text-on-primary hover:opacity-90"
            onClick={download}
          >
            <DownloadSimple size={16} aria-hidden="true" />
            Download backup
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-mid px-3.5 py-2 text-sm hover:border-primary/50"
            onClick={() => {
              void navigator.clipboard.writeText(store.backupJson());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <>
                <CheckCircle size={14} aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden="true" />
                Copy to clipboard
              </>
            )}
          </button>
        </div>
        <p className="mt-3 mono-sm text-muted-foreground">
          Restore: install VeruShield Connect → Restore from backup at onboarding → paste this file.
        </p>
      </div>

      {cfg.mode === "demo" && (
        <div className="rounded-xl border border-border bg-surface-lowest p-4">
          <div className="label-caps text-muted-foreground">Demo proving latency</div>
          <p className="mt-1 text-sm text-foreground">
            {cfg.provingSeconds}s{" "}
            <span className="text-muted-foreground">(production median ~29s)</span>
          </p>
          <input
            type="range"
            min={3}
            max={29}
            value={cfg.provingSeconds}
            onChange={(e) => store.updateConnection({ provingSeconds: Number(e.target.value) })}
            className="mt-3 w-full accent-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Lower this only for demos. Prefer Trade-off Config for hosted vs self-hosted choice.
          </p>
        </div>
      )}
    </div>
  );
}

function SessionPanel({ onClose }: { onClose: () => void }) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const cfg = store.config!;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface-lowest p-4">
        <div className="label-caps text-muted-foreground">Architecture defaults</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-surface-low p-3">
            <div className="label-caps text-muted-foreground">Proving</div>
            <div className="mt-1 text-sm font-medium text-primary">
              {cfg.provingMode === "self" ? "Self-hosted WASM" : "Hosted SGX"}
            </div>
          </div>
          <div className="rounded-lg bg-surface-low p-3">
            <div className="label-caps text-muted-foreground">Submission</div>
            <div className="mt-1 text-sm font-medium text-secondary">
              {cfg.submissionMode === "paymaster" ? "Paymaster relay" : "Direct submit"}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Change these in{" "}
          <strong className="text-foreground">Trade-off Config</strong> from the left rail —
          Settings only summarizes the live policy.
        </p>
      </div>

      <div className="rounded-xl border border-warn/40 bg-warn-bg p-4">
        <div className="flex items-start gap-2">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <div>
            <div className="label-caps text-warn">Auditor escrow</div>
            <p className="mt-1 text-sm text-warn">
              Messages are private from everyone except a designated auditor under lawful process.
              Not for anonymous tips or dissident communication. Full text is under Compliance
              Disclosure.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-destructive">
          <SignOut size={16} aria-hidden="true" />
          Disconnect
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Clears keys, contacts, and local state from this browser and returns to onboarding.
          Download a backup first if you want to restore later — on-chain messages stay, but without
          your key you cannot read them here.
        </p>
        {!confirmDisconnect ? (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-destructive/60 px-3.5 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmDisconnect(true)}
          >
            <SignOut size={16} aria-hidden="true" />
            Disconnect
          </button>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-sm font-semibold text-on-destructive hover:opacity-90"
              onClick={() => {
                store.disconnect();
                onClose();
              }}
            >
              <SignOut size={16} aria-hidden="true" />
              Yes, clear this browser
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-mid hover:text-foreground"
              onClick={() => setConfirmDisconnect(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Privacy Settings modal — connection, backup, session.
 * Trade-off proving/submission lives in Trade-off Config (left rail), not here.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>("connection");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);

    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (!firstEl || !lastEl) return;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "connection", label: "Connection" },
    { id: "backup", label: "Backup" },
    { id: "session", label: "Session" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-lowest/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-[min(640px,94vw)] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-mid shadow-[0px_8px_24px_rgba(0,0,0,0.65)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="optical-rail" />

        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
                Privacy Settings
              </h2>
              <span className="mono-sm rounded bg-surface-highest px-1.5 py-0.5 text-muted-foreground">
                v0.9.4
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Connection, key custody, and session controls for this browser.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-high hover:text-foreground"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          className="flex gap-1 border-b border-border bg-surface-lowest px-3 pt-2"
          role="tablist"
          aria-label="Settings sections"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`rounded-t-lg px-3.5 py-2 text-sm transition-colors ${
                tab === t.id
                  ? "bg-surface-mid font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" role="tabpanel">
          {tab === "connection" && <ConnectionEditor onSaved={onClose} />}
          {tab === "backup" && <BackupPanel />}
          {tab === "session" && <SessionPanel onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}
