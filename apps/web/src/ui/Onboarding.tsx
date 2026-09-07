import { useEffect, useState } from "react";
import { randomFelt, store } from "../lib/store.js";
import type { Contact } from "../lib/contacts.js";
import { describeAmount, parseAmount, STRK_TOKEN } from "../lib/amounts.js";
import { MAINNET_WALLET_PRESET, SEPOLIA_PRESET, SEPOLIA_WALLET_PRESET } from "../lib/presets.js";
import { chainName, connectWallet, deriveViewingKey, explainProbe, probeStrk20, READY_INSTALL_URL, READY_NAME, readyWallets, registeredOnPool, strk20Submit, watchForReady, WalletRequestError, type InjectedWallet, type Strk20Support } from "../lib/wallet.js";
import { sdkAvailable } from "../lib/privacySdk.js";

/**
 * The three disclosures live HERE, at onboarding — not in settings, not in a
 * footnote (12-client-and-ui.md). Each requires its own acknowledgement.
 */
const DISCLOSURES = [
  {
    title: "An auditor can read your messages",
    body:
      "This system inherits STRK20's compliance model: an escrowed auditor key can recover " +
      "message content under lawful process. Your messages are hidden from the public, " +
      "not from a court order.",
  },
  {
    title: "Messages are permanent",
    body:
      "Messages are written to blockchain storage that can never be edited or deleted — " +
      "not by you, not by the recipient, not by us. There is no delete button anywhere " +
      "in this app, because a delete button would be a lie.",
  },
  {
    title: "“A message was sent” is public",
    body:
      "Anyone watching the chain can see that some message of a certain size was sent at a " +
      "certain time. They cannot see who sent it, who received it, or what it says.",
  },
] as const;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [acks, setAcks] = useState([false, false, false]);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [keys, setKeys] = useState<{ viewingKey: string; accountAddress: string; contacts: Contact[] } | null>(null);
  const [registering, setRegistering] = useState(false);

  // Wallet path: Ready (or another STRK20 wallet) keeps the keys; this app never sees them.
  const [wallets, setWallets] = useState<InjectedWallet[]>(() => readyWallets());
  const [wallet, setWallet] = useState<{ w: InjectedWallet; address: string; chainId: string; support: Strk20Support | "checking" } | null>(null);
  /** On-chain: does the pool for the wallet's network know this account? null = not checked / unreachable. */
  const [onChain, setOnChain] = useState<boolean | null>(null);
  const checkOnChain = (chainId: string, address: string) => {
    const preset = chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
    setOnChain(null);
    registeredOnPool(preset.rpcUrl, preset.poolAddress, address).then(setOnChain, () => setOnChain(null));
  };
  const [walletError, setWalletError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => watchForReady(setWallets), []);

  /** One button, whatever the state: connect if Ready is here, else rescan once and point to the install page. */
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
      const preset = chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
      const support = await explainProbe(await probeStrk20(w), address, preset.rpcUrl, preset.poolAddress, [SEPOLIA_PRESET.accountAddress, store.config?.accountAddress ?? ""]);
      setWallet({ w, address, chainId, support });
    } catch (e) {
      setWalletError(`${w.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Shield through the wallet: a `deposit` action. Ready's own service issues
  // the screening attestation the pool demands (an SDK deposit from app-held
  // keys reverts with SCREENING_REQUIRED — 15 § B10), and a first deposit is
  // what activates privacy and registers the viewing key for the account.
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
      const preset = wallet.chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
      const { RpcProvider } = await import("starknet");
      const receipt = await new RpcProvider({ nodeUrl: preset.rpcUrl }).waitForTransaction(txHash);
      const ok = (receipt as { isSuccess?: () => boolean }).isSuccess?.() ?? true;
      if (!ok) throw new Error(`transaction ${txHash} reverted: ${(receipt as { revert_reason?: string }).revert_reason ?? "unknown"}`);
      setShieldState({ phase: "done", tx: txHash });
      checkOnChain(wallet.chainId, wallet.address);
      setWallet({ ...wallet, support: await probeStrk20(wallet.w) });
    } catch (e) {
      const msg =
        e instanceof WalletRequestError && e.kind === "NOT_REGISTERED"
          ? `${e.walletName} answered NOT_REGISTERED: it refuses every STRK20 action, deposits included, until it has registered this account itself — and a dapp cannot trigger that. Activate privacy inside ${e.walletName} (asset → Shield → activation prompt). If ${e.walletName} shows no such option on ${chainName(wallet.chainId)}, privacy is not offered for this account on this network: use it on mainnet, or use pool mode with your own key (Settings).`
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
  // the wallet to sign with the proof attached (poolBackend.ts `proofInvoke`).
  // Nothing in the wallet's own STRK20 support is needed — only signing.
  const [signerState, setSignerState] = useState<"idle" | "signing" | "failed">("idle");
  const [signerError, setSignerError] = useState<string | null>(null);
  const finishAsSigner = async () => {
    if (!wallet) return;
    const preset = wallet.chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
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
    const preset = wallet.chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
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

  const finish = (k: NonNullable<typeof keys>) => {
    setRegistering(true);
    // Registration (SetViewingKey) is bundled into first use — autoRegister
    // semantics, no separate transaction demanded of the user upfront.
    store.completeOnboarding(
      {
        mode: "demo",
        viewingKey: k.viewingKey,
        accountAddress: k.accountAddress,
        provingSeconds: 29,
      },
      k.contacts
    );
  };

  if (step === 0) {
    return (
      <div className="onboarding">
        <h1>STRK20 Messages</h1>
        <p className="lede">
          Private messaging on Starknet. Before you start, three things you must know — really
          know, not scroll past:
        </p>
        {DISCLOSURES.map((d, i) => (
          <label key={d.title} className={`disclosure ${acks[i] ? "acked" : ""}`}>
            <input
              type="checkbox"
              checked={acks[i]}
              onChange={() => setAcks(acks.map((a, j) => (i === j ? !a : a)))}
            />
            <div>
              <strong>{d.title}</strong>
              <p>{d.body}</p>
            </div>
          </label>
        ))}
        <button className="primary" disabled={!acks.every(Boolean)} onClick={() => setStep(1)}>
          I understand all three
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding">
      <h1>Your key</h1>
      <p className="lede">
        One viewing key is your identity, your inbox and your backup. Everything else — your
        entire message history — can be rebuilt from it. Keep it in your wallet, or in this
        browser to try things out.
      </p>
      {!keys && !restoreOpen && !wallet && (
        <div className="key-choices">
          <button className="primary wallet-choice" onClick={connectReady} title={wallets.length ? `${READY_NAME} is installed — connect it` : `${READY_NAME} is not installed yet — opens the install page`}>
            {wallets[0]?.icon && <img src={wallets[0].icon} alt="" />}
            Connect {READY_NAME} wallet
          </button>
          <button
            onClick={() =>
              setKeys({ viewingKey: randomFelt(), accountAddress: randomFelt(), contacts: [] })
            }
          >
            Try the demo with a new key
          </button>
          <button onClick={() => setRestoreOpen(true)}>Restore from backup</button>
          <p className="hint" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
            <strong>{READY_NAME}</strong> (formerly Argent X) keeps the account key and the STRK20 viewing key and
            signs every transaction behind its own prompt — nothing is pasted here.
          </p>
          {notFound && (
            <p className="probe-err" style={{ flexBasis: "100%", margin: "4px 0 0" }}>
              {READY_NAME} is not installed in this browser. Install it from{" "}
              <a href={READY_INSTALL_URL} target="_blank" rel="noreferrer">
                ready.co
              </a>
              , then reload this page and click again.
            </p>
          )}
          {walletError && <p className="error" style={{ flexBasis: "100%" }}>{walletError}</p>}
        </div>
      )}
      {wallet && !keys && (
        <div className="key-summary">
          <p>
            <strong>{wallet.w.name}:</strong> <code>{shorten(wallet.address)}</code> · {chainName(wallet.chainId)}
          </p>
          {wallet.support === "checking" ? (
            <p className="hint">asking the wallet whether it speaks STRK20…</p>
          ) : wallet.support.ok ? (
            <p className={wallet.support.registered ? "probe-ok" : "hint"}>
              {wallet.support.registered
                ? `✓ STRK20 ready · shielded: ${
                    wallet.support.balances.length ? wallet.support.balances.map((b) => describeAmount(b.balance, b.token)).join(", ") : "nothing yet — shield in the wallet to pay"
                  }`
                : "✓ STRK20 wallet API available. This account is not registered on the pool yet: shield any amount inside the wallet once (that registers your viewing key). You can message meanwhile."}
            </p>
          ) : wallet.support.kind === "unsupported" ? (
            <p className="probe-err">
              ✗ {wallet.support.reason}. Every send here — messages included — goes through the wallet's STRK20 API, so
              <strong> nothing will send</strong> with this wallet until it implements it. Use {READY_NAME}, or the demo, or pool mode with your own key (Settings).
            </p>
          ) : wallet.support.kind === "refused" ? (
            <p className="probe-err">✗ {wallet.support.reason}.</p>
          ) : (
            <div className="probe-err">
              <p style={{ margin: "0 0 6px" }}>✗ {wallet.support.reason}.</p>
              {onChain === true ? (
                <p className="hint" style={{ margin: 0 }}>
                  {wallet.support.hint ?? (
                    <>
                      On-chain, the <strong>{chainName(wallet.chainId)}</strong> pool <em>does</em> know this account (a viewing key is
                      registered), yet the wallet cannot serve it. Either that key was registered by something other than {READY_NAME}
                      (this app's pool mode, the CLI, a script — then {READY_NAME} can never use this account: registration is once per
                      account, so create a NEW account in {READY_NAME}, shield once inside it, and connect that), or {READY_NAME}'s privacy
                      backend does not support {chainName(wallet.chainId)} — switch it to{" "}
                      {wallet.chainId === MAINNET_WALLET_PRESET.chainId ? "Sepolia" : "mainnet"} and reconnect.
                    </>
                  )}
                </p>
              ) : onChain === false ? (
                <p className="hint" style={{ margin: 0 }}>
                  On-chain, the <strong>{chainName(wallet.chainId)}</strong> pool has <em>no viewing key</em> for this account: it never
                  shielded here. In {READY_NAME}, on {chainName(wallet.chainId)}, find <em>Privacy</em> / <em>Shield</em> and shield any small
                  amount of STRK once — that registers the key. Then click “check again”. If {READY_NAME} offers no privacy option on{" "}
                  {chainName(wallet.chainId)}, switch it to {wallet.chainId === MAINNET_WALLET_PRESET.chainId ? "Sepolia" : "mainnet"} and reconnect.
                </p>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  The API is there, so this is usually setup, not support. In {READY_NAME}, on <strong>{chainName(wallet.chainId)}</strong>:
                  shield any small amount of STRK once (that registers your viewing key), then click “check again”. If {READY_NAME} shows
                  no privacy option on this network, switch it to the other network and reconnect.
                </p>
              )}
            </div>
          )}
          {wallet.chainId === MAINNET_WALLET_PRESET.chainId && !MAINNET_WALLET_PRESET.helperAddress && (
            <p className="hint">
              Mainnet: the helper contract address is not set in this build — Settings opens after this step so you can paste it.
            </p>
          )}
          <div className="shield-box">
            <strong>Shield through {wallet.w.name}</strong>
            <span className="hint">
              Moves STRK from your public balance into the pool as a private note — the transaction that activates privacy
              and registers your viewing key. {wallet.w.name} builds, screens and signs it; you approve it in the wallet.
              Costs the amount plus the pool fee (2 STRK on Sepolia, 4 on mainnet) and gas.
            </span>
            <span className="row">
              <input
                className="mono"
                style={{ maxWidth: 140 }}
                value={shieldAmount}
                onChange={(e) => setShieldAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="STRK"
                disabled={shieldState.phase === "wallet" || shieldState.phase === "confirming"}
              />
              <span className="hint">STRK</span>
              <button
                className="primary"
                disabled={parseAmount(shieldAmount, 18) === null || shieldState.phase === "wallet" || shieldState.phase === "confirming"}
                onClick={() => void shieldViaWallet()}
              >
                {shieldState.phase === "wallet" ? "approve in the wallet…" : shieldState.phase === "confirming" ? "confirming on-chain…" : `Shield ${shieldAmount || "…"} STRK`}
              </button>
            </span>
            {shieldState.phase === "confirming" && (
              <span className="hint">
                submitted ·{" "}
                <a href={explorer + shieldState.tx} target="_blank" rel="noreferrer">
                  {shieldState.tx.slice(0, 12)}…
                </a>
              </span>
            )}
            {shieldState.phase === "done" && (
              <span className="probe-ok">
                ✓ shielded ·{" "}
                <a href={explorer + shieldState.tx} target="_blank" rel="noreferrer">
                  {shieldState.tx.slice(0, 12)}…
                </a>{" "}
                — re-checking the wallet
              </span>
            )}
            {shieldState.phase === "failed" && <span className="probe-err">✗ {shieldState.error}</span>}
          </div>
          <div className="shield-box">
            <strong>{wallet.w.name} as signer, this app as prover</strong>
            <span className="hint">
              Needs nothing from the wallet's own privacy support: {wallet.w.name} signs one message to derive a viewing key
              that lives in this app, then signs each pool transaction with the proof attached (SNIP-36{" "}
              <code>proof</code> on <code>wallet_addInvokeTransaction</code>). Proving runs on this app's prover (Settings →{" "}
              <code>/prover</code>). Full pool mode: pool channels, discovery, receipts.
              {onChain === true ? ` Note: this account already has a viewing key on the pool; it must be the one derived here, or discovery finds nothing.` : ""}
            </span>
            {!sdkAvailable() && (
              <span className="probe-err">This build has no Privacy SDK bundled — start the app with the checkout (apps/web/README.md) to use this route.</span>
            )}
            <span className="row">
              <button className="primary" disabled={!sdkAvailable() || registering || signerState === "signing"} onClick={() => void finishAsSigner()}>
                {signerState === "signing" ? "sign the message in the wallet…" : `Use ${wallet.w.name} as signer`}
              </button>
            </span>
            {signerError && <span className="probe-err">✗ {signerError}</span>}
          </div>
          <div className="row">
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
            <button className="ghost" onClick={() => setWallet(null)}>
              back
            </button>
          </div>
        </div>
      )}
      {restoreOpen && !keys && (
        <div className="restore">
          <textarea
            placeholder="Paste your backup JSON here"
            value={restoreText}
            onChange={(e) => setRestoreText(e.target.value)}
            rows={8}
          />
          {restoreError && <p className="error">{restoreError}</p>}
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
        </div>
      )}
      {keys && (
        <div className="key-summary">
          <p>
            <strong>Account:</strong> <code>{shorten(keys.accountAddress)}</code>
          </p>
          <p className="hint">
            Registration happens automatically with your first action — no separate transaction.
          </p>
          <button className="primary" disabled={registering} onClick={() => finish(keys)}>
            {registering ? "Registering…" : keys.contacts.length > 0 ? `Restore ${keys.contacts.length} contact(s) and start` : "Start messaging"}
          </button>
        </div>
      )}
    </div>
  );
}

export function shorten(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}
