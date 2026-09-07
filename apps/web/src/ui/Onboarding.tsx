import { ArrowRight, Lock, Warning, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { randomFelt, store } from "../lib/store.js";
import type { Contact } from "../lib/contacts.js";
import { describeAmount, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { MAINNET_WALLET_PRESET, SEPOLIA_PRESET, SEPOLIA_WALLET_PRESET } from "../lib/presets.js";
import { chainName, connectWallet, deriveViewingKey, explainProbe, probeStrk20, READY_INSTALL_URL, READY_NAME, readyWallets, registeredOnPool, strk20Submit, switchChain, watchForReady, WalletRequestError, type InjectedWallet, type Strk20Support } from "../lib/wallet.js";
import { sdkAvailable } from "../lib/privacySdk.js";
import { WorkspaceShell, type AppRoute } from "./WorkspaceShell.js";

/**
 * Compliance disclosure is mandatory and non-skippable (12-client-and-ui.md):
 * the three things a user must know live HERE, each with its own
 * acknowledgement — not in settings, not in a footnote. Then the key: a
 * wallet that keeps it, or a browser key for the demo.
 */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const [route, setRoute] = useState<AppRoute>("compliance");
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [acks, setAcks] = useState([false, false, false]);
  const [keys, setKeys] = useState<{ viewingKey: string; accountAddress: string; contacts: Contact[] } | null>(null);
  const [provingMode, setProvingMode] = useState<"hosted" | "self">("self");
  const [registering, setRegistering] = useState(false);
  const disclosureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === 0) setRoute("compliance");
    else if (step === 2) setRoute("tradeoffs");
    else setRoute("conversations");
  }, [step]);

  useEffect(() => {
    const el = disclosureRef.current;
    if (!el || step !== 0) return;
    const check = () => {
      if (el.scrollHeight - el.clientHeight <= 8 || el.scrollHeight - el.scrollTop - el.clientHeight <= 8) setScrolledToEnd(true);
    };
    check();
    el.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [step]);

  const finishDemo = (k: NonNullable<typeof keys>) => {
    setRegistering(true);
    store.completeOnboarding(
      { mode: "demo", viewingKey: k.viewingKey, accountAddress: k.accountAddress, provingSeconds: provingMode === "self" ? 29 : 4, provingMode },
      k.contacts
    );
  };

  const locked: AppRoute[] = ["conversations", "settings"];
  if (!keys) locked.push("tradeoffs");

  return (
    <WorkspaceShell
      route={route}
      onRoute={(r) => {
        if (r === "compliance") setStep(0);
        else if (r === "tradeoffs" && keys) setStep(2);
      }}
      identity={keys?.accountAddress ?? null}
      lockedRoutes={locked}
    >
      <main ref={disclosureRef} className="min-h-0 flex-1 overflow-y-auto bg-surface" aria-label={step === 0 ? "Compliance disclosure" : undefined}>
        {step === 0 && <ComplianceStep scrolledToEnd={scrolledToEnd} acks={acks} setAcks={setAcks} onContinue={() => setStep(1)} />}
        {step === 1 && <KeyStep keys={keys} setKeys={setKeys} onContinue={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && keys && (
          <DemoDefaultsStep provingMode={provingMode} setProvingMode={setProvingMode} registering={registering} contactCount={keys.contacts.length} onFinish={() => finishDemo(keys)} onBack={() => setStep(1)} />
        )}
      </main>
    </WorkspaceShell>
  );
}

const DISCLOSURES = [
  {
    title: "An auditor can read your messages",
    body: "This system inherits STRK20's compliance model: an escrowed auditor key can recover message content under lawful process. Your messages are hidden from the public, not from a court order.",
    ack: "I understand and accept this limitation — content is decryptable by a designated auditor under lawful process.",
    icon: <Lock size={16} className="text-primary" aria-hidden="true" />,
  },
  {
    title: "Messages are permanent",
    body: "Messages are written to blockchain storage that can never be edited or deleted — not by you, not by the recipient, not by us. There is no delete button anywhere in this app, because a delete button would be a lie.",
    ack: "I understand messages are permanent — there is no delete.",
    icon: <Warning size={16} className="text-warn" aria-hidden="true" />,
  },
  {
    title: "“A message was sent” is public",
    body: "Anyone watching the chain can see that some message of a certain size was sent at a certain time, from which account, through which helper. They cannot see who received it or what it says.",
    ack: "I understand that “a message was sent”, its size, its timing and the paying account are public.",
    icon: <WarningCircle size={16} className="text-muted-foreground" aria-hidden="true" />,
  },
] as const;

function ComplianceStep({ scrolledToEnd, acks, setAcks, onContinue }: { scrolledToEnd: boolean; acks: boolean[]; setAcks: (a: boolean[]) => void; onContinue: () => void }) {
  const canContinue = scrolledToEnd && acks.every(Boolean);
  return (
    <div className="flex min-h-full w-full flex-col px-6 py-6 lg:px-10 lg:py-8">
      <div className="mb-6 flex w-full flex-col items-start justify-between gap-2 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
          <span className="label-caps tracking-widest text-primary">01 / Before you start · three things to really know</span>
        </div>
        <span className="mono-sm rounded-full bg-surface-low px-2.5 py-0.5 text-secondary">STRK20 · Starknet</span>
      </div>

      <div className="flex w-full flex-1 flex-col rounded-xl bg-surface-lowest shadow-2xl">
        <div className="optical-rail rounded-t-xl" />
        <div className="flex flex-1 flex-col p-6 sm:p-8 lg:p-10">
          <div className="flex w-full flex-col items-center text-center lg:items-start lg:text-left">
            <img src={`${import.meta.env.BASE_URL}verushield-logo.svg`} alt="VeruShield Connect" width={96} height={96} className="mb-6 h-24 w-24 rounded-2xl shadow-lg" draggable={false} />
            <span className="label-caps mb-2 tracking-widest text-secondary">Private messaging on Starknet</span>
            <h1 className="mb-4 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
              Your messages are private from everyone <span className="text-primary">except a designated auditor</span>
            </h1>
            <p className="max-w-4xl text-base leading-relaxed text-muted-foreground">
              VeruShield Connect encrypts each message in your browser and stores the ciphertext through the STRK20 privacy pool, at storage slots only the two parties can compute. Payments ride in the same transaction as their memo. STRK20 escrows viewing keys to an auditor for lawful process.
            </p>
          </div>

          <div className="mt-8 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            {DISCLOSURES.map((d, i) => (
              <div key={d.title} className="flex flex-col justify-between rounded-lg bg-surface-low p-4">
                <div>
                  <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-mid">{d.icon}</div>
                  <span className="label-caps mb-0.5 block text-muted-foreground">0{i + 1}</span>
                  <h4 className="mb-1.5 text-lg font-semibold leading-snug text-foreground">{d.title}</h4>
                  <p className="text-xs leading-relaxed text-muted-foreground">{d.body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 w-full rounded-lg border border-warn/40 bg-warn-bg p-4">
            <div className="mb-1 flex items-center gap-2">
              <Warning size={16} weight="fill" className="text-warn" aria-hidden="true" />
              <span className="label-caps text-warn">Not for everyone</span>
            </div>
            <p className="text-sm text-warn">
              <strong>Not suitable for anonymous whistleblowing or dissident communication.</strong> If your threat model includes an adversary who can compel the auditor, do not use this product. Sender anonymity is not claimed: you pay from your own account.
            </p>
          </div>

          {!scrolledToEnd && <p className="sticky bottom-0 mt-4 bg-gradient-to-t from-surface-lowest via-surface-lowest to-transparent pt-8 text-center text-xs text-muted-foreground">Scroll to the end to unlock the acknowledgements</p>}

          <div className="mt-6 flex w-full flex-col gap-2.5">
            {DISCLOSURES.map((d, i) => (
              <label key={d.title} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${acks[i] ? "border-primary bg-primary/10" : "border-border bg-surface-low"} ${!scrolledToEnd ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-1 accent-primary" checked={acks[i]} disabled={!scrolledToEnd} onChange={() => setAcks(acks.map((a, j) => (i === j ? !a : a)))} />
                <span className="flex gap-2 text-sm text-foreground">
                  {d.icon}
                  {d.ack}
                </span>
              </label>
            ))}
          </div>

          <button type="button" className="mt-6 mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-45 sm:w-auto" disabled={!canContinue} onClick={onContinue}>
            I understand all three — continue
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyStep({ keys, setKeys, onContinue, onBack }: { keys: { viewingKey: string; accountAddress: string; contacts: Contact[] } | null; setKeys: (k: { viewingKey: string; accountAddress: string; contacts: Contact[] }) => void; onContinue: () => void; onBack: () => void }) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  // Wallet path: Ready X keeps the keys; this app never sees them.
  const [wallets, setWallets] = useState<InjectedWallet[]>(() => readyWallets());
  const [wallet, setWallet] = useState<{ w: InjectedWallet; address: string; chainId: string; support: Strk20Support | "checking" } | null>(null);
  /** On-chain: does the pool for the wallet's network know this account? null = not checked / unreachable. */
  const [onChain, setOnChain] = useState<boolean | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => watchForReady(setWallets), []);

  const presetFor = (chainId: string) => (chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET);
  const checkOnChain = (chainId: string, address: string) => {
    const preset = presetFor(chainId);
    setOnChain(null);
    registeredOnPool(preset.rpcUrl, preset.poolAddress, address).then(setOnChain, () => setOnChain(null));
  };

  const connectReady = () => {
    const w = wallets[0] ?? readyWallets()[0];
    if (w) {
      setNotFound(false);
      void connect(w);
      return;
    }
    setNotFound(true);
    window.open(READY_INSTALL_URL, "_blank", "noreferrer");
  };

  const connect = async (w: InjectedWallet) => {
    setWalletError(null);
    try {
      const { address, chainId } = await connectWallet(w);
      setWallet({ w, address, chainId, support: "checking" });
      checkOnChain(chainId, address);
      const preset = presetFor(chainId);
      const support = await explainProbe(await probeStrk20(w), address, preset.rpcUrl, preset.poolAddress, [SEPOLIA_PRESET.accountAddress, store.config?.accountAddress ?? ""]);
      setWallet({ w, address, chainId, support });
    } catch (e) {
      setWalletError(`${w.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Shield through the wallet: a `deposit` action. Ready's own service issues
  // the screening attestation the pool demands, and a first deposit is what
  // activates privacy and registers the viewing key for the account.
  const [shieldAmount, setShieldAmount] = useState("1");
  const [shieldState, setShieldState] = useState<{ phase: "idle" } | { phase: "wallet" } | { phase: "confirming"; tx: string } | { phase: "done"; tx: string } | { phase: "failed"; error: string }>({ phase: "idle" });
  const shieldViaWallet = async () => {
    if (!wallet) return;
    const amount = parseAmount(shieldAmount, 18);
    if (amount === null) return;
    setShieldState({ phase: "wallet" });
    try {
      const { txHash } = await strk20Submit(wallet.w, [{ type: "deposit", token: STRK_TOKEN, amount: "0x" + amount.toString(16) }]);
      setShieldState({ phase: "confirming", tx: txHash });
      const { RpcProvider } = await import("starknet");
      const receipt = await new RpcProvider({ nodeUrl: presetFor(wallet.chainId).rpcUrl }).waitForTransaction(txHash);
      const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
      if (!ok) throw new Error(`transaction ${txHash} reverted: ${(receipt as { revert_reason?: string }).revert_reason ?? "unknown"}`);
      setShieldState({ phase: "done", tx: txHash });
      checkOnChain(wallet.chainId, wallet.address);
      setWallet({ ...wallet, support: await probeStrk20(wallet.w) });
    } catch (e) {
      const msg =
        e instanceof WalletRequestError && e.kind === "NOT_REGISTERED"
          ? `${e.walletName} answered NOT_REGISTERED: it refuses every STRK20 action, deposits included, until it has registered this account itself — and a dapp cannot trigger that. Activate privacy inside ${e.walletName} (asset → Shield). If ${e.walletName} shows no such option on ${chainName(wallet.chainId)}, privacy is not offered for this account on this network.`
          : e instanceof WalletRequestError
            ? `${e.walletName} rejected ${e.method}: ${e.raw}`
            : e instanceof Error
              ? e.message
              : String(e);
      setShieldState({ phase: "failed", error: msg });
    }
  };
  const explorer = wallet?.chainId === MAINNET_WALLET_PRESET.chainId ? "https://voyager.online/tx/" : "https://sepolia.voyager.online/tx/";

  // Ready X as SIGNER only: the app derives a viewing key from a wallet
  // signature, proves with its own prover, and hands each pool transaction to
  // the wallet to sign with the proof attached.
  const [signerState, setSignerState] = useState<"idle" | "signing" | "failed">("idle");
  const [signerError, setSignerError] = useState<string | null>(null);
  const finishAsSigner = async () => {
    if (!wallet) return;
    const preset = presetFor(wallet.chainId);
    setSignerState("signing");
    setSignerError(null);
    try {
      const viewingKey = await deriveViewingKey(wallet.w, wallet.address, wallet.chainId, preset.poolAddress);
      setRegistering(true);
      store.completeOnboarding({
        mode: "pool",
        viewingKey,
        accountAddress: wallet.address,
        provingSeconds: 29,
        rpcUrl: preset.rpcUrl,
        helperAddress: preset.helperAddress || undefined,
        poolAddress: preset.poolAddress,
        carrierToken: preset.carrierToken,
        walletId: wallet.w.id,
        accountKey: undefined,
        poolLocal: false,
        provingUrl: "/prover",
        gatewayUrl: undefined,
      });
    } catch (e) {
      setSignerState("failed");
      setSignerError(e instanceof Error ? e.message : String(e));
    }
  };

  const finishWithWallet = () => {
    if (!wallet) return;
    setRegistering(true);
    const preset = presetFor(wallet.chainId);
    store.completeOnboarding({
      mode: "wallet",
      viewingKey: "", // inside the wallet
      accountAddress: wallet.address,
      provingSeconds: 29,
      rpcUrl: preset.rpcUrl,
      helperAddress: preset.helperAddress || undefined,
      poolAddress: preset.poolAddress,
      carrierToken: preset.carrierToken,
      walletId: wallet.w.id,
    });
  };

  return (
    <div className="legacy flex min-h-full w-full flex-col px-6 py-8 lg:px-10 lg:py-10">
      <span className="label-caps text-primary">02 / Your key</span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">Your key</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        One viewing key is your identity, your inbox and your backup. Everything else — your entire message history — can be rebuilt from it. Keep it in your wallet, or in this browser to try things out.
      </p>

      <div className="mt-6 w-full rounded-xl border border-border bg-surface-lowest p-6 lg:p-8">
        {!keys && !restoreOpen && !wallet && (
          <div className="key-choices">
            <button className="primary wallet-choice" onClick={connectReady} title={wallets.length ? `${READY_NAME} is installed — connect it` : `${READY_NAME} is not installed yet — opens the install page`}>
              {wallets[0]?.icon && <img src={wallets[0].icon} alt="" />}
              Connect {READY_NAME} wallet
            </button>
            <button onClick={() => setKeys({ viewingKey: randomFelt(), accountAddress: randomFelt(), contacts: [] })}>Try the demo with a new key</button>
            <button onClick={() => setRestoreOpen(true)}>Restore from backup</button>
            <p className="hint" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
              <strong>{READY_NAME}</strong> (formerly Argent X) keeps the account key and the STRK20 viewing key and signs every transaction behind its own prompt — nothing is pasted here.
            </p>
            {notFound && (
              <p className="probe-err" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
                {READY_NAME} is not installed in this browser. Install it from{" "}
                <a href={READY_INSTALL_URL} target="_blank" rel="noreferrer">ready.co</a>, then reload this page and click again.
              </p>
            )}
            {walletError && <p className="error" style={{ flexBasis: "100%" }}>{walletError}</p>}
          </div>
        )}

        {wallet && !keys && (
          <div className="key-summary">
            <p>
              <strong>{wallet.w.name}:</strong> <code className="rounded bg-surface-high px-1.5 py-0.5 text-secondary">{shorten(wallet.address)}</code> ·{" "}
              <strong className={wallet.chainId === MAINNET_WALLET_PRESET.chainId ? "text-primary" : "text-secondary"}>{chainName(wallet.chainId)}</strong>
              <button
                className="ghost small"
                style={{ marginLeft: 8 }}
                title={`Ask ${wallet.w.name} to switch network, then re-check`}
                onClick={() => {
                  const target = wallet.chainId === MAINNET_WALLET_PRESET.chainId ? SEPOLIA_WALLET_PRESET.chainId : MAINNET_WALLET_PRESET.chainId;
                  void switchChain(wallet.w, target).then(
                    (ok) => ok && connect(wallet.w),
                    (e: unknown) => setWalletError(`${wallet.w.name}: ${e instanceof Error ? e.message : String(e)}`)
                  );
                }}
              >
                switch to {wallet.chainId === MAINNET_WALLET_PRESET.chainId ? "Sepolia" : "mainnet"}
              </button>
            </p>
            {wallet.chainId === MAINNET_WALLET_PRESET.chainId && (
              <p className="probe-ok" style={{ margin: "4px 0" }}>
                Mainnet: real funds. Helper <code>{shorten(MAINNET_WALLET_PRESET.helperAddress)}</code> is live and pinned to the STRK20 pool. Every send is one pool transaction: <strong>6 STRK pool fee + gas</strong>, approved in {wallet.w.name}.
              </p>
            )}
            {wallet.support === "checking" ? (
              <p className="hint">asking the wallet whether it speaks STRK20…</p>
            ) : wallet.support.ok ? (
              <p className={wallet.support.registered ? "probe-ok" : "probe-err"}>
                {wallet.support.registered
                  ? `✓ STRK20 ready · shielded: ${wallet.support.balances.length ? wallet.support.balances.map((b) => describeAmount(b.balance, b.token)).join(", ") : "nothing yet — shield in the wallet to pay"}`
                  : `✗ STRK20 wallet API available, but the wallet cannot use this account on the pool. ${wallet.support.hint ?? "Shield any amount inside the wallet once (that registers your viewing key), then check again."}`}
              </p>
            ) : wallet.support.kind === "unsupported" ? (
              <p className="probe-err">
                ✗ {wallet.support.reason}. Every send here — messages included — goes through the wallet's STRK20 API, so <strong>nothing will send</strong> with this wallet until it implements it. Use {READY_NAME}, or the demo, or pool mode with your own key (Settings).
              </p>
            ) : wallet.support.kind === "refused" ? (
              <p className="probe-err">✗ {wallet.support.reason}.</p>
            ) : (
              <div className="probe-err">
                <p style={{ margin: "0 0 6px" }}>✗ {wallet.support.reason}.</p>
                <p className="hint" style={{ margin: 0 }}>
                  {wallet.support.hint ??
                    (onChain === true
                      ? `On-chain, the ${chainName(wallet.chainId)} pool does know this account, yet the wallet cannot serve it. Either that key was registered by something other than ${READY_NAME} (then ${READY_NAME} can never use this account — registration is once per account: create a NEW account in ${READY_NAME}, shield once inside it, and connect that), or ${READY_NAME}'s privacy backend does not support ${chainName(wallet.chainId)}.`
                      : onChain === false
                        ? `On-chain, the ${chainName(wallet.chainId)} pool has no viewing key for this account: it never shielded here. In ${READY_NAME}, shield any small amount of STRK once — that registers the key — then click “check again”.`
                        : `The API is there, so this is usually setup, not support. In ${READY_NAME}, on ${chainName(wallet.chainId)}: shield any small amount of STRK once (that registers your viewing key), then click “check again”.`)}
                </p>
              </div>
            )}
            {wallet.chainId === MAINNET_WALLET_PRESET.chainId && !MAINNET_WALLET_PRESET.helperAddress && (
              <p className="hint">Mainnet: the helper contract address is not set in this build — Settings opens after this step so you can paste it.</p>
            )}
            <div className="shield-box">
              <strong>Shield through {wallet.w.name}</strong>
              <span className="hint">
                Moves STRK from your public balance into the pool as a private note — the transaction that activates privacy and registers your viewing key. {wallet.w.name} builds, screens and signs it; you approve it in the wallet. Costs the amount plus the pool fee and gas.
              </span>
              <span className="row">
                <input className="mono" style={{ maxWidth: 140 }} value={shieldAmount} onChange={(e) => setShieldAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="STRK" disabled={shieldState.phase === "wallet" || shieldState.phase === "confirming"} />
                <span className="hint">STRK</span>
                <button className="primary" disabled={parseAmount(shieldAmount, 18) === null || shieldState.phase === "wallet" || shieldState.phase === "confirming"} onClick={() => void shieldViaWallet()}>
                  {shieldState.phase === "wallet" ? "approve in the wallet…" : shieldState.phase === "confirming" ? "confirming on-chain…" : `Shield ${shieldAmount || "…"} STRK`}
                </button>
              </span>
              {shieldState.phase === "confirming" && (
                <span className="hint">submitted · <a href={explorer + shieldState.tx} target="_blank" rel="noreferrer">{shieldState.tx.slice(0, 12)}…</a></span>
              )}
              {shieldState.phase === "done" && (
                <span className="probe-ok">✓ shielded · <a href={explorer + shieldState.tx} target="_blank" rel="noreferrer">{shieldState.tx.slice(0, 12)}…</a> — re-checking the wallet</span>
              )}
              {shieldState.phase === "failed" && <span className="probe-err">✗ {shieldState.error}</span>}
            </div>
            <div className="shield-box">
              <strong>{wallet.w.name} as signer, this app as prover</strong>
              <span className="hint">
                Needs nothing from the wallet's own privacy support: {wallet.w.name} signs one message to derive a viewing key that lives in this app, then signs each pool transaction with the proof attached. Proving runs on this app's prover. Full pool mode: pool channels, discovery, receipts.
                {onChain === true ? " Note: this account already has a viewing key on the pool; it must be the one derived here, or discovery finds nothing." : ""}
              </span>
              {!sdkAvailable() && <span className="probe-err">This build has no Privacy SDK bundled — start the app with the checkout (apps/web/README.md) to use this route.</span>}
              <span className="row">
                <button className="primary" disabled={!sdkAvailable() || registering || signerState === "signing"} onClick={() => void finishAsSigner()}>
                  {signerState === "signing" ? "sign the message in the wallet…" : `Use ${wallet.w.name} as signer`}
                </button>
              </span>
              {signerError && <span className="probe-err">✗ {signerError}</span>}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" disabled={registering || wallet.support === "checking"} onClick={finishWithWallet}>
                {registering ? "Connecting…" : `Start messaging with ${wallet.w.name} (wallet proves)`}
              </button>
              <button
                className="ghost"
                disabled={wallet.support === "checking"}
                onClick={() => {
                  setWallet({ ...wallet, support: "checking" });
                  checkOnChain(wallet.chainId, wallet.address);
                  void probeStrk20(wallet.w).then((support) => setWallet((cur) => (cur ? { ...cur, support } : cur)));
                }}
              >
                check again
              </button>
              <button className="ghost" onClick={() => setWallet(null)}>back</button>
            </div>
          </div>
        )}

        {restoreOpen && !keys && (
          <div className="restore">
            <textarea placeholder="Paste your backup JSON here" value={restoreText} onChange={(e) => setRestoreText(e.target.value)} rows={8} />
            {restoreError && <p className="error">{restoreError}</p>}
            <span className="row">
              <button
                className="primary"
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
              <button className="ghost" onClick={() => setRestoreOpen(false)}>back</button>
            </span>
          </div>
        )}

        {keys && (
          <div className="key-summary">
            <p>
              <strong>Account:</strong> <code className="rounded bg-surface-high px-1.5 py-0.5 text-secondary">{shorten(keys.accountAddress)}</code>
            </p>
            <p className="hint">Demo mode: a simulated pool in this browser, nothing leaves your machine. Registration happens automatically with your first action.</p>
            <button className="primary" onClick={onContinue}>
              <span className="inline-flex items-center gap-2">
                {keys.contacts.length > 0 ? `Restore ${keys.contacts.length} contact(s) and continue` : "Continue"}
                <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </span>
            </button>
          </div>
        )}
      </div>
      <button type="button" className="mt-4 self-start text-sm text-muted-foreground hover:text-foreground" style={{ border: 0, background: "transparent", padding: 0 }} onClick={onBack}>
        ← Back to the disclosure
      </button>
    </div>
  );
}

function DemoDefaultsStep({ provingMode, setProvingMode, registering, contactCount, onFinish, onBack }: { provingMode: "hosted" | "self"; setProvingMode: (v: "hosted" | "self") => void; registering: boolean; contactCount: number; onFinish: () => void; onBack: () => void }) {
  return (
    <div className="flex min-h-full w-full flex-col px-6 py-8 lg:px-10 lg:py-10">
      <span className="label-caps text-primary">03 / Demo defaults</span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">How honest should the demo be about proving?</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every real send is proved with zero-knowledge cryptography before it can be submitted. The demo simulates that wait. You can change this later under Privacy trade-offs.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <ChoiceCard selected={provingMode === "self"} title="Honest (~29 s)" tag="measured" body="The latency measured on mainnet with the app's own prover. Nothing leaves the device." onClick={() => setProvingMode("self")} />
        <ChoiceCard selected={provingMode === "hosted"} title="Fast (~4 s)" tag="for demos" body="Simulates a hosted prover: quick, but a real one sees the witness before the proof wraps it." onClick={() => setProvingMode("hosted")} />
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="rounded-lg border border-border bg-surface-low px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-on-primary hover:opacity-90 disabled:opacity-45" disabled={registering} onClick={onFinish}>
          {registering ? "Starting…" : contactCount > 0 ? `Restore ${contactCount} contact(s) and start` : "Start messaging"}
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ChoiceCard({ selected, title, tag, body, onClick }: { selected: boolean; title: string; tag: string; body: string; onClick: () => void }) {
  return (
    <button type="button" className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${selected ? "active-top-rail border-primary/50 bg-surface-high" : "border-border bg-surface-lowest hover:border-border-strong hover:bg-surface-low"}`} onClick={onClick}>
      <div className="flex items-center justify-between gap-2">
        <strong className={selected ? "text-primary" : "text-foreground"}>{title}</strong>
        <span className="mono-sm rounded bg-surface-mid px-1.5 py-0.5 text-secondary">{tag}</span>
      </div>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
    </button>
  );
}

export function shorten(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}
