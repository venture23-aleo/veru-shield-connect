import { useEffect, useState } from "react";
import {
  MAINNET_WALLET_PRESET,
  SEPOLIA_POOL_PRESET,
  SEPOLIA_PRESET,
  SEPOLIA_WALLET_PRESET,
  isHex,
  listSncastAccounts,
  parseCredentialsPaste,
  parseDevnetEnv,
  probeBalance,
  probeConnection,
  probeSigner,
  type DevnetEnv,
  type SncastAccount,
} from "../lib/presets.js";
import { probeProver } from "../lib/poolBackend.js";
import { sdkAvailable } from "../lib/privacySdk.js";
import { store, type Mode } from "../lib/store.js";
import { buildActions, chainName, connectWallet, deriveViewingKey, diagnoseStrk20, explainProbe, probeStrk20, READY_INSTALL_URL, READY_NAME, readyWallets, switchChain, watchForReady, type DiagnosticLine, type InjectedWallet, type Strk20Support } from "../lib/wallet.js";
import { describeAmount } from "../lib/amounts.js";
import { shorten } from "./Onboarding.js";

/** Mode switcher + connection details for direct and pool modes, with presets and a probe. */
function ConnectionEditor({ onSaved }: { onSaved: () => void }) {
  const cfg = store.config!;
  // Dev prefill: `pnpm run web:devenv` writes apps/web/.env.local (git-ignored,
  // testnet keys only). Fields prefill; nothing connects until Save.
  const envSigner = {
    address: (import.meta.env.VITE_DEV_SIGNER_ADDRESS as string | undefined) ?? "",
    key: (import.meta.env.VITE_DEV_SIGNER_KEY as string | undefined) ?? "",
  };
  const [mode, setMode] = useState<Mode>(cfg.mode);
  const [rpcUrl, setRpcUrl] = useState(cfg.rpcUrl ?? SEPOLIA_PRESET.rpcUrl);
  const [helper, setHelper] = useState(
    cfg.mode === "direct" ? (cfg.helperAddress ?? "") : envSigner.address ? SEPOLIA_PRESET.helperAddress : ""
  );
  const [account, setAccount] = useState(
    cfg.mode !== "demo" ? cfg.accountAddress : envSigner.address
  );
  const [key, setKey] = useState(cfg.accountKey ?? envSigner.key);
  const [identity, setIdentity] = useState(cfg.identityAddress ?? "");
  const [showKey, setShowKey] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | "checking" | null>(null);
  const [saved, setSaved] = useState(false);
  const [keyPub, setKeyPub] = useState<string | null>(null);

  // -- pool mode ------------------------------------------------------------
  const [poolHelper, setPoolHelper] = useState(
    cfg.mode === "pool" ? (cfg.helperAddress ?? "") : SEPOLIA_POOL_PRESET.helperAddress
  );
  const [poolAddress, setPoolAddress] = useState(cfg.poolAddress ?? SEPOLIA_POOL_PRESET.poolAddress);
  const [poolLocal, setPoolLocal] = useState(cfg.poolLocal ?? false);
  const [provingUrl, setProvingUrl] = useState(cfg.provingUrl ?? "");
  const [discoveryUrl, setDiscoveryUrl] = useState(cfg.discoveryUrl ?? "");
  const [carrierToken, setCarrierToken] = useState(cfg.carrierToken ?? SEPOLIA_POOL_PRESET.carrierToken);
  const [gatewayUrl, setGatewayUrl] = useState(cfg.gatewayUrl ?? "/gateway");
  const [screeningUrl, setScreeningUrl] = useState(cfg.screeningProvingUrl ?? "");
  const [viewingKey, setViewingKey] = useState(cfg.viewingKey);
  const [showVk, setShowVk] = useState(false);
  const [devnetOpen, setDevnetOpen] = useState(false);
  const [devnetAccounts, setDevnetAccounts] = useState<DevnetEnv["accounts"]>([]);
  const [devnetNote, setDevnetNote] = useState<string | null>(null);
  const [proverProbe, setProverProbe] = useState<{ ok: boolean; detail: string } | "checking" | null>(null);
  const [signerProbe, setSignerProbe] = useState<{ ok: boolean; detail: string } | "checking" | null>(null);
  const [balance, setBalance] = useState<{ strk: number; allowance: number; fee: number } | "checking" | { error: string } | null>(null);

  // -- wallet mode (Ready, or any wallet with the STRK20 wallet API) ---------
  const [wallets, setWallets] = useState<InjectedWallet[]>(() => readyWallets());
  const [walletId, setWalletId] = useState(cfg.walletId ?? "");
  const [walletAddress, setWalletAddress] = useState(cfg.mode === "wallet" ? cfg.accountAddress : "");
  const [walletChain, setWalletChain] = useState<string | null>(null);
  const [walletNote, setWalletNote] = useState<string | null>(null);
  const [walletProbe, setWalletProbe] = useState<Strk20Support | "checking" | null>(null);
  const [walletNet, setWalletNet] = useState<"sepolia" | "mainnet">(
    cfg.mode === "wallet" && (cfg.rpcUrl ?? "").includes("mainnet") ? "mainnet" : "sepolia"
  );
  const walletPreset = walletNet === "mainnet" ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
  useEffect(() => watchForReady(setWallets), []);
  const [walletNotFound, setWalletNotFound] = useState(false);
  const connectReady = () => {
    const w = wallets[0] ?? readyWallets()[0];
    if (w) {
      setWalletNotFound(false);
      void connect(w);
      return;
    }
    setWalletNotFound(true);
    window.open(READY_INSTALL_URL, "_blank", "noreferrer");
  };
  const applyWalletPreset = (net: "sepolia" | "mainnet") => {
    const p = net === "mainnet" ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
    setWalletNet(net);
    setRpcUrl(p.rpcUrl);
    setPoolHelper(p.helperAddress);
    setPoolAddress(p.poolAddress);
    setCarrierToken(p.carrierToken);
  };
  const connect = async (w: InjectedWallet) => {
    setWalletNote("waiting for the wallet…");
    setWalletProbe(null);
    try {
      const { address, chainId } = await connectWallet(w);
      setWalletId(w.id);
      setWalletAddress(address);
      setWalletChain(chainId);
      setWalletNote(`✓ ${w.name} · ${shorten(address)} · ${chainName(chainId)}`);
      setWalletProbe("checking");
      const preset = chainId === MAINNET_WALLET_PRESET.chainId ? MAINNET_WALLET_PRESET : SEPOLIA_WALLET_PRESET;
      setWalletProbe(await explainProbe(await probeStrk20(w), address, preset.rpcUrl, preset.poolAddress, [SEPOLIA_PRESET.accountAddress, account, cfg.accountAddress]));
    } catch (e) {
      setWalletNote(`${w.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const walletChainMismatch = walletChain !== null && walletChain !== walletPreset.chainId;

  // Pool mode signed by the wallet (no key in the app): connect, derive the
  // viewing key from a signature, and let the prover do the rest.
  const [poolSigner, setPoolSigner] = useState<string>(cfg.mode === "pool" && !cfg.accountKey && cfg.walletId ? cfg.walletId : "");
  const [poolSignerNote, setPoolSignerNote] = useState<string | null>(null);
  const connectPoolSigner = async () => {
    const w = wallets[0] ?? readyWallets()[0];
    if (!w) {
      setPoolSignerNote(`${READY_NAME} is not installed in this browser — install it from ready.co, reload, and click again.`);
      return;
    }
    setPoolSignerNote("waiting for the wallet…");
    try {
      const { address, chainId } = await connectWallet(w);
      if (!isHex(poolAddress)) throw new Error("set the pool address first (⚡ Sepolia preset)");
      setPoolSignerNote("sign the viewing-key message in the wallet…");
      const vk = await deriveViewingKey(w, address, chainId, poolAddress.trim());
      setAccount(address);
      setKey("");
      setViewingKey(vk);
      setPoolSigner(w.id);
      setPoolSignerNote(`✓ ${w.name} · ${shorten(address)} · ${chainName(chainId)} — signs every transaction; viewing key derived from its signature`);
    } catch (e) {
      setPoolSignerNote(`${w.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const [diag, setDiag] = useState<DiagnosticLine[] | "running" | null>(null);
  const runDiagnostic = async () => {
    const w = wallets.find((x) => x.id === walletId);
    if (!w) return;
    setDiag("running");
    // The exact shape a message-only send uses: a zero carrier to self + the helper call.
    const sample = buildActions([], { contract: poolHelper.trim() || "0x1", calldata: ["0x0"] }, { token: carrierToken.trim() || SEPOLIA_WALLET_PRESET.carrierToken, self: walletAddress || "0x1", amount: 0n });
    setDiag(await diagnoseStrk20(w, sample));
  };

  // Live: which keypair is actually in the field? Derived locally, never sent.
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

  const applyPoolPreset = () => {
    setRpcUrl(SEPOLIA_POOL_PRESET.rpcUrl);
    setPoolHelper(SEPOLIA_POOL_PRESET.helperAddress);
    setPoolAddress(SEPOLIA_POOL_PRESET.poolAddress);
    setCarrierToken(SEPOLIA_POOL_PRESET.carrierToken);
    setPoolLocal(false);
    // The dev server proxies `/prover` to a prover on its own machine — the
    // right default whenever the browser is elsewhere (see vite.config.ts).
    if (!provingUrl.trim()) setProvingUrl("/prover");
  };

  const applyDevnet = (text: string) => {
    const env = parseDevnetEnv(text);
    if (!env) {
      setDevnetNote("That isn't the block scripts/pool-devnet.mjs prints.");
      return;
    }
    setRpcUrl(env.rpcUrl);
    setPoolHelper(env.helperAddress);
    setPoolAddress(env.poolAddress);
    setCarrierToken(env.carrierToken);
    setPoolLocal(true);
    setDevnetAccounts(env.accounts);
    const first = env.accounts[0]!;
    setAccount(first.address);
    setKey(first.privateKey);
    setViewingKey(first.viewingKey);
    setDevnetNote(`✓ local devnet · ${env.accounts.length} seeded account(s) — you are ${first.name}; pick another below if this browser is someone else`);
    setDevnetOpen(false);
  };

  const [fileAccounts, setFileAccounts] = useState<SncastAccount[]>([]);

  const applyPaste = (text: string) => {
    const creds = parseCredentialsPaste(text, account);
    if (!creds) {
      setPasteNote("Couldn't recognize that — paste your sncast accounts JSON, an app backup, or a bare 0x… key.");
      return;
    }
    if (creds.accountAddress) setAccount(creds.accountAddress);
    if (creds.privateKey) setKey(creds.privateKey);
    setPasteNote(`✓ imported from ${creds.source}${creds.privateKey ? " (address + key)" : " (address only)"}`);
    setFileAccounts(listSncastAccounts(text)); // multi-account file → "who are you?" chooser
    setPasteOpen(false);
    setProbe(null);
  };

  const signerAddr = account.trim();
  const chosenIdentity = identity.trim() || signerAddr;

  const runProbe = async () => {
    setProbe("checking");
    setProbe(await probeConnection(rpcUrl.trim(), helper.trim(), account.trim(), key.trim() || undefined));
  };

  const fieldOk = {
    helper: isHex(helper),
    account: isHex(account),
    key: isHex(key),
    poolHelper: isHex(poolHelper),
    pool: isHex(poolAddress),
    carrier: isHex(carrierToken),
    vk: isHex(viewingKey),
  };
  const poolReady =
    rpcUrl.trim() !== "" &&
    fieldOk.poolHelper &&
    fieldOk.pool &&
    fieldOk.account &&
    (fieldOk.key || poolSigner !== "") &&
    fieldOk.vk &&
    fieldOk.carrier &&
    (poolLocal || provingUrl.trim() !== "");
  const walletReady =
    rpcUrl.trim() !== "" && fieldOk.poolHelper && fieldOk.pool && fieldOk.carrier && isHex(walletAddress) && walletId !== "" && !walletChainMismatch;
  const canSave =
    mode === "demo" ||
    (mode === "wallet" && walletReady) ||
    (mode === "direct" && rpcUrl.trim() !== "" && fieldOk.helper && fieldOk.account && fieldOk.key) ||
    (mode === "pool" && poolReady && sdkAvailable());

  const save = async () => {
    if (mode === "pool" && !poolLocal && !poolSigner) {
      setSignerProbe("checking");
      const r = await probeSigner(rpcUrl.trim(), account.trim(), key.trim());
      setSignerProbe(r);
      if (!r.ok && !/could not read/.test(r.detail)) return; // a key that provably does not control the account
    }
    if (mode === "demo") {
      store.updateConnection({ mode: "demo" });
    } else if (mode === "wallet") {
      store.updateConnection({
        mode: "wallet",
        rpcUrl: rpcUrl.trim(),
        helperAddress: poolHelper.trim(),
        poolAddress: poolAddress.trim(),
        accountAddress: walletAddress.trim(),
        walletId,
        carrierToken: carrierToken.trim(),
        accountKey: undefined,
        identityAddress: undefined, // wallet mode: identity IS the wallet account
      });
    } else if (mode === "direct") {
      store.updateConnection({
        mode: "direct",
        rpcUrl: rpcUrl.trim(),
        helperAddress: helper.trim(),
        accountAddress: account.trim(),
        accountKey: key.trim(),
        identityAddress: identity.trim() || undefined,
      });
    } else {
      store.updateConnection({
        mode: "pool",
        rpcUrl: rpcUrl.trim(),
        helperAddress: poolHelper.trim(),
        poolAddress: poolAddress.trim(),
        accountAddress: account.trim(),
        accountKey: poolSigner ? undefined : key.trim(),
        walletId: poolSigner || undefined,
        viewingKey: viewingKey.trim(),
        poolLocal,
        provingUrl: poolLocal ? undefined : provingUrl.trim(),
        discoveryUrl: discoveryUrl.trim() || undefined,
        carrierToken: carrierToken.trim(),
        gatewayUrl: poolLocal ? undefined : gatewayUrl.trim() || "/gateway",
        screeningProvingUrl: poolLocal ? undefined : screeningUrl.trim() || undefined,
        identityAddress: undefined, // pool mode: identity IS the account
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
    <div>
      <p className="connected-now">
        Connected now: <strong>{current.mode}</strong>
        {current.mode !== "demo" && (
          <>
            {" "}· signer{" "}
            <code title={current.accountAddress}>{shorten(current.accountAddress)}</code>
            {current.mode === "direct" && (
              <>
                {" "}· you are{" "}
                <code title={current.identityAddress || current.accountAddress}>
                  {shorten(current.identityAddress || current.accountAddress)}
                </code>
              </>
            )}
            {current.mode === "wallet" && (
              <>
                {" "}· via <strong>{current.walletId}</strong> · pool <code title={current.poolAddress}>{shorten(current.poolAddress ?? "")}</code>
              </>
            )}
            {current.mode === "pool" && (
              <>
                {current.walletId && !current.accountKey ? <> · signed by <strong>{current.walletId}</strong></> : null}
                {" "}· pool <code title={current.poolAddress}>{shorten(current.poolAddress ?? "")}</code>
                {current.poolLocal ? " · local devnet (mock proving)" : ""}
              </>
            )}
          </>
        )}
      </p>
      <div className="mode-picker">
        {(
          [
            ["demo", "Demo", "Simulated pool in this browser — nothing leaves your machine"],
            ["wallet", "Wallet", "Ready X signs and proves — no keys pasted here"],
            ["pool", "Pool", "STRK20 pool with your own keys — needs a proving URL"],
            ["direct", "Direct", "Real helper over RPC — dev mode, nothing is private"],
          ] as const
        ).map(([value, title, desc]) => (
          <button
            key={value}
            className={`mode-card ${mode === value ? "selected" : ""}`}
            onClick={() => {
              setMode(value);
              setProbe(null);
            }}
          >
            <strong>{title}</strong>
            <span>{desc}</span>
          </button>
        ))}
      </div>

      {mode === "wallet" && (
        <>
          <p className="hint">
            The wallet holds your account key <em>and</em> your STRK20 viewing key: it proves, signs and
            submits each transaction behind its own prompt (<code>wallet_strk20InvokeTransaction</code>).
            This app never sees a key. Messages pair by address, like direct mode; value moves through the pool.
          </p>
          <div className="row" style={{ margin: "6px 0 10px" }}>
            <button className={walletNet === "sepolia" ? "primary" : ""} onClick={() => applyWalletPreset("sepolia")}>
              ⚡ {SEPOLIA_WALLET_PRESET.label}
            </button>
            <button className={walletNet === "mainnet" ? "primary" : ""} onClick={() => applyWalletPreset("mainnet")}>
              ⚡ {MAINNET_WALLET_PRESET.label}
            </button>
          </div>
          <div className="wallet-row">
            <button className="primary" onClick={connectReady}>
              {wallets[0]?.icon && <img src={wallets[0].icon} alt="" style={{ verticalAlign: "middle", marginRight: 6 }} />}
              {walletId && walletAddress ? `Reconnect ${READY_NAME} wallet` : `Connect ${READY_NAME} wallet`}
            </button>
            {walletNotFound && (
              <span className="probe-err">
                {READY_NAME} is not installed in this browser — install it from{" "}
                <a href={READY_INSTALL_URL} target="_blank" rel="noreferrer">
                  ready.co
                </a>
                , reload, and click again.
              </span>
            )}
          </div>
          {walletNote && <p className={walletNote.startsWith("✓") ? "probe-ok" : "hint"}>{walletNote}</p>}
          {walletChainMismatch && walletChain && (
            <p className="probe-err">
              The wallet is on <strong>{chainName(walletChain)}</strong>; this preset is {walletNet}.{" "}
              <button
                className="ghost"
                onClick={() => {
                  const w = wallets.find((x) => x.id === walletId);
                  if (!w) return;
                  void switchChain(w, walletPreset.chainId).then(
                    (ok) => ok && setWalletChain(walletPreset.chainId),
                    (e: unknown) => setWalletNote(`switch failed: ${e instanceof Error ? e.message : String(e)}`)
                  );
                }}
              >
                switch the wallet to {walletNet}
              </button>{" "}
              — or pick the other preset above.
            </p>
          )}
          {walletProbe === "checking" && <p className="hint">asking the wallet whether it speaks STRK20 (wallet_strk20Balances)…</p>}
          {walletProbe && walletProbe !== "checking" && (
            <p className={walletProbe.ok && walletProbe.registered ? "probe-ok" : "probe-err"}>
              {walletProbe.ok
                ? walletProbe.registered
                  ? `✓ STRK20 wallet API available · shielded: ${
                      walletProbe.balances.length ? walletProbe.balances.map((b) => describeAmount(b.balance, b.token)).join(", ") : "nothing yet"
                    }`
                  : "✓ STRK20 wallet API available — but this account is not registered on the pool yet. Shield any amount inside the wallet once (that registers your viewing key), then come back."
                : `✗ ${walletProbe.reason}${
                    walletProbe.hint
                      ? ` — ${walletProbe.hint}`
                      : walletProbe.kind === "error"
                        ? " — the API exists; in the wallet, shield any amount once on this network to set privacy up, then reconnect. Run the diagnostic below for the raw answers."
                        : ""
                  }`}
            </p>
          )}
          {walletId && walletAddress && (
            <div className="field">
              <span className="row">
                <button className="ghost" disabled={diag === "running"} onClick={() => void runDiagnostic()}>
                  {diag === "running" ? "asking the wallet…" : "Run STRK20 diagnostic"}
                </button>
                <span className="hint">read-only and simulate-only calls: nothing is signed or spent. Paste the result into an issue if a send fails.</span>
              </span>
              {Array.isArray(diag) && (
                <ul className="diag">
                  {diag.map((d) => (
                    <li key={d.method} className={d.ok ? "probe-ok" : "probe-err"}>
                      <code>{d.method}</code> → {d.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <label className="field">
            RPC URL
            <input className="mono" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
            <span className="hint">Used only to read the helper's storage and confirm transactions. starknet.js 10.5 needs spec 0.9.0 or 0.10.2.</span>
          </label>
          <label className="field">
            Helper contract (message_anonymizer, pinned to this pool)
            <input
              className={`mono ${poolHelper && !fieldOk.poolHelper ? "invalid" : ""}`}
              placeholder={walletNet === "mainnet" ? "0x… — deploy contracts/ to mainnet first (DEPLOYMENTS.md)" : "0x…"}
              value={poolHelper}
              onChange={(e) => setPoolHelper(e.target.value)}
            />
          </label>
          <label className="field">
            STRK20 pool
            <input className={`mono ${poolAddress && !fieldOk.pool ? "invalid" : ""}`} value={poolAddress} onChange={(e) => setPoolAddress(e.target.value)} />
          </label>
          <label className="field">
            Carrier / default pay token
            <input className={`mono ${carrierToken && !fieldOk.carrier ? "invalid" : ""}`} value={carrierToken} onChange={(e) => setCarrierToken(e.target.value)} />
            <span className="hint">A message-only send carries a zero-value note of this token to yourself (the pool's replay protection).</span>
          </label>
        </>
      )}

      {mode === "pool" && (
        <>
          {!sdkAvailable() && (
            <p className="probe-err">
              This build has no Privacy SDK: start the app with <code>STARKNET_PRIVACY=&lt;checkout&gt;</code>{" "}
              (see apps/web/README.md). Pool mode cannot be saved until then.
            </p>
          )}
          <div className="row" style={{ margin: "6px 0 10px" }}>
            <button onClick={applyPoolPreset}>⚡ {SEPOLIA_POOL_PRESET.label}</button>
            <button className={poolSigner ? "primary" : ""} onClick={() => void connectPoolSigner()} title={`${READY_NAME} signs; this app proves and holds the viewing key`}>
              {poolSigner ? `signer: ${READY_NAME} ✓ (reconnect)` : `Sign with ${READY_NAME} instead of a key`}
            </button>
            {poolSigner && (
              <button
                className="ghost"
                onClick={() => {
                  setPoolSigner("");
                  setPoolSignerNote(null);
                }}
              >
                use a pasted key instead
              </button>
            )}
            <button className="ghost" onClick={() => setPasteOpen(!pasteOpen)}>
              paste credentials…
            </button>
            <button className="ghost" onClick={() => setDevnetOpen(!devnetOpen)}>
              paste local devnet env…
            </button>
          </div>
          {pasteOpen && (
            <textarea
              rows={4}
              placeholder="Paste ~/.starknet_accounts/starknet_open_zeppelin_accounts.json, an app backup, or a bare 0x… private key — account fields fill themselves."
              onChange={(e) => e.target.value.trim() && applyPaste(e.target.value)}
            />
          )}
          {pasteNote && <p className="hint">{pasteNote}</p>}
          {poolSignerNote && <p className={poolSignerNote.startsWith("✓") ? "probe-ok" : "hint"}>{poolSignerNote}</p>}
          {fileAccounts.length > 1 && (
            <div className="field">
              Which account is <strong>you</strong> in this browser?
              <div className="row" style={{ marginTop: 4 }}>
                {fileAccounts.map((a) => {
                  const selected = isHex(account) && isHex(a.address) && BigInt(account) === BigInt(a.address);
                  return (
                    <button
                      key={a.name}
                      className={selected ? "primary" : ""}
                      onClick={() => {
                        setAccount(a.address);
                        setKey(a.privateKey);
                      }}
                    >
                      {a.name} <code style={{ marginLeft: 4 }}>{shorten(a.address)}</code>
                    </button>
                  );
                })}
              </div>
              <span className="hint">
                Pool mode signs with this account and it is your identity — pick the one whose
                key you pasted. Each browser should be a different account.
              </span>
            </div>
          )}
          {devnetOpen && (
            <textarea
              rows={4}
              placeholder="Paste the JSON block printed by: STARKNET_PRIVACY=<checkout> node scripts/pool-devnet.mjs"
              onChange={(e) => e.target.value.trim() && applyDevnet(e.target.value)}
            />
          )}
          {devnetNote && <p className="hint">{devnetNote}</p>}
          {devnetAccounts.length > 1 && (
            <div className="field">
              Who are <strong>you</strong> in this browser?
              <div className="row" style={{ marginTop: 4 }}>
                {devnetAccounts.map((a) => {
                  const selected = isHex(account) && BigInt(account) === BigInt(a.address);
                  return (
                    <button
                      key={a.name}
                      className={selected ? "primary" : ""}
                      onClick={() => {
                        setAccount(a.address);
                        setKey(a.privateKey);
                        setViewingKey(a.viewingKey);
                      }}
                    >
                      {a.name} <code style={{ marginLeft: 4 }}>{shorten(a.address)}</code>
                    </button>
                  );
                })}
              </div>
              <span className="hint">
                Open a second browser (or a private window) as the other account to see both sides.
              </span>
            </div>
          )}

          <label className="field">
            RPC URL
            <input className="mono" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </label>
          <label className="field">
            Helper contract (pool-mode deployment — its <code>pool</code> is the STRK20 pool)
            <input
              className={`mono ${poolHelper && !fieldOk.poolHelper ? "invalid" : ""}`}
              placeholder="0x…"
              value={poolHelper}
              onChange={(e) => setPoolHelper(e.target.value)}
            />
          </label>
          <label className="field">
            STRK20 pool address
            <input
              className={`mono ${poolAddress && !fieldOk.pool ? "invalid" : ""}`}
              placeholder="0x…"
              value={poolAddress}
              onChange={(e) => setPoolAddress(e.target.value)}
            />
          </label>
          <label className="field">
            Your account address
            <input
              className={`mono ${account && !fieldOk.account ? "invalid" : ""}`}
              placeholder="0x…"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setBalance(null);
              }}
            />
            <span className="hint">
              You submit your own transactions: this address is public on every payment, by design.
            </span>
            <span className="row" style={{ marginTop: 4 }}>
              <button
                className="ghost"
                disabled={!fieldOk.account || !fieldOk.pool || !rpcUrl.trim()}
                onClick={() => {
                  setBalance("checking");
                  void probeBalance(rpcUrl.trim(), account.trim(), poolAddress.trim())
                    .then(setBalance)
                    .catch((e: unknown) => setBalance({ error: e instanceof Error ? e.message : String(e) }));
                }}
              >
                Check balance
              </button>
              {balance === "checking" && <span className="hint">reading…</span>}
              {balance && balance !== "checking" && ("error" in balance ? (
                <span className="probe-err">{balance.error}</span>
              ) : (
                <span className={balance.strk >= balance.fee + 3 ? "probe-ok" : "probe-err"}>
                  {balance.strk.toLocaleString()} STRK · allowance to pool {balance.allowance.toLocaleString()} · pool fee{" "}
                  {balance.fee} STRK per transaction · a message costs about {balance.fee + 2.5} STRK all-in
                  {balance.strk < balance.fee + 3 ? " — too low to send, top up" : ""}
                </span>
              ))}
            </span>
          </label>
          {poolSigner ? (
            <p className="hint">
              No private key: <strong>{READY_NAME}</strong> signs each transaction (plain ones as usual; pool ones with the proof
              attached). The viewing key below was derived from its signature — reconnecting re-derives the same one.
            </p>
          ) : null}
          <label className="field" hidden={!!poolSigner}>
            Account private key
            <span className="row">
              <input
                className={`mono ${key && !fieldOk.key ? "invalid" : ""}`}
                type={showKey ? "text" : "password"}
                placeholder="0x… (testnet key only — stored in this browser)"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setSignerProbe(null);
                }}
              />
              <button className="ghost" onClick={() => setShowKey(!showKey)}>
                {showKey ? "hide" : "show"}
              </button>
              <button
                className="ghost"
                disabled={!fieldOk.account || !fieldOk.key || !rpcUrl.trim()}
                onClick={() => {
                  setSignerProbe("checking");
                  void probeSigner(rpcUrl.trim(), account.trim(), key.trim()).then(setSignerProbe);
                }}
              >
                Test signer
              </button>
            </span>
            {signerProbe === "checking" && <span className="hint">checking the account's signer on-chain…</span>}
            {signerProbe && signerProbe !== "checking" && (
              <span className={signerProbe.ok ? "probe-ok" : "probe-err"}>{signerProbe.detail}</span>
            )}
            <span className="hint">
              Must be the key that controls the account above — the pool signs the proven
              transaction with it. Checked on Save.
            </span>
          </label>
          <label className="field">
            Viewing key
            <span className="row">
              <input
                className={`mono ${viewingKey && !fieldOk.vk ? "invalid" : ""}`}
                type={showVk ? "text" : "password"}
                value={viewingKey}
                onChange={(e) => setViewingKey(e.target.value)}
              />
              <button className="ghost" onClick={() => setShowVk(!showVk)}>
                {showVk ? "hide" : "show"}
              </button>
            </span>
            <span className="hint">
              The key registered on the pool (<code>SetViewingKey</code>, bundled into your first
              transaction). Your notes and channels are derived from it — a different key doesn’t
              fail, it just sees nothing.
            </span>
          </label>
          <label className="field">
            Carrier / default pay token
            <input
              className={`mono ${carrierToken && !fieldOk.carrier ? "invalid" : ""}`}
              placeholder="0x…"
              value={carrierToken}
              onChange={(e) => setCarrierToken(e.target.value)}
            />
            <span className="hint">
              A message without a payment still needs one pool note to ride on: a 1-wei transfer
              to yourself in this token. Payments need no carrier.
            </span>
          </label>
          <label className="field">
            <span className="row">
              <input type="checkbox" checked={poolLocal} onChange={(e) => setPoolLocal(e.target.checked)} />
              Local devnet — mock proving
            </span>
            <span className="hint">
              For testing against <code>scripts/pool-devnet.mjs</code>. Off = a real prover: the
              operator's, or one you run yourself (apps/web/README.md § Sepolia).
            </span>
          </label>
          {!poolLocal && (
            <label className="field">
              Proving service URL
              <span className="row">
                <input
                  className="mono"
                  placeholder="/prover (dev-server proxy) · http://localhost:3000 · or the operator's"
                  value={provingUrl}
                  onChange={(e) => {
                    setProvingUrl(e.target.value);
                    setProverProbe(null);
                  }}
                />
                <button
                  className="ghost"
                  disabled={!provingUrl.trim()}
                  onClick={() => {
                    setProverProbe("checking");
                    void probeProver(provingUrl).then(setProverProbe);
                  }}
                >
                  Test prover
                </button>
              </span>
              {proverProbe === "checking" && <span className="hint">checking from this browser…</span>}
              {proverProbe && proverProbe !== "checking" && (
                <span className={proverProbe.ok ? "probe-ok" : "probe-err"}>{proverProbe.detail}</span>
              )}
              <span className="hint">
                <code>/prover</code> reaches the prover running on the dev server's machine —
                use it when this browser is somewhere else. The prover sees the full witness —
                sender, recipient, amount. OHTTP hides only your IP and needs a gateway: it is
                off for <code>/prover</code> and any plain <code>http://</code> URL.
              </span>
            </label>
          )}
          {!poolLocal && (
            <label className="field">
              Submission gateway
              <input className="mono" value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} />
              <span className="hint">
                Proof-carrying transactions go to StarkWare's gateway, not the RPC (the RPC's write
                path corrupts the privacy fields). <code>/gateway</code> is the dev server's proxy to
                it — browsers cannot post there directly.
              </span>
            </label>
          )}
          {!poolLocal && (
            <label className="field">
              Screening prover URL (deposits only, optional)
              <input className="mono" placeholder="the operator's screening-enabled prover — empty = your prover" value={screeningUrl} onChange={(e) => setScreeningUrl(e.target.value)} />
              <span className="hint">
                The pool screens deposits: the attestation comes back from a prover that runs the
                operator's screening sidecar. Without it, Shield reverts with{" "}
                <code>SCREENING_REQUIRED</code>. Messages never need it. If the browser cannot call
                it directly, start the dev server with <code>SCREENING_PROVER_URL=…</code> and put{" "}
                <code>/screening-prover</code> here.
              </span>
            </label>
          )}
          <label className="field">
            Discovery indexer URL (optional)
            <input className="mono" placeholder="empty = read the pool contract over RPC" value={discoveryUrl} onChange={(e) => setDiscoveryUrl(e.target.value)} />
            <span className="hint">
              Without an indexer, channels and notes are found by scanning the pool contract over
              RPC — works anywhere, just slower.
            </span>
          </label>
        </>
      )}

      {mode === "direct" && (
        <>
          <div className="row" style={{ margin: "6px 0 10px" }}>
            <button onClick={applyPreset}>⚡ {SEPOLIA_PRESET.label}</button>
            <button className="ghost" onClick={() => setPasteOpen(!pasteOpen)}>
              paste credentials…
            </button>
          </div>
          {envSigner.key && (
            <p className="hint">
              dev signer prefilled from <code>.env.local</code>{" "}
              (<code>{shorten(envSigner.address)}</code>) — pick who you are below and Save.
            </p>
          )}
          {pasteOpen && (
            <textarea
              rows={4}
              placeholder="Paste ~/.starknet_accounts/starknet_open_zeppelin_accounts.json, an app backup, or a bare 0x… private key — fields fill themselves."
              onChange={(e) => e.target.value.trim() && applyPaste(e.target.value)}
            />
          )}
          {pasteNote && <p className="hint">{pasteNote}</p>}

          <label className="field">
            RPC URL
            <input className="mono" value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} />
          </label>
          <label className="field">
            Helper contract address
            <input
              className={`mono ${helper && !fieldOk.helper ? "invalid" : ""}`}
              placeholder="0x…"
              value={helper}
              onChange={(e) => setHelper(e.target.value)}
            />
          </label>
          <label className="field">
            Your account address
            <input
              className={`mono ${account && !fieldOk.account ? "invalid" : ""}`}
              placeholder="0x…"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <span className="hint">Must be the account the helper was deployed with (its `pool`) — Test connection checks this.</span>
          </label>
          {poolSigner ? (
            <p className="hint">
              No private key: <strong>{READY_NAME}</strong> signs each transaction (plain ones as usual; pool ones with the proof
              attached). The viewing key below was derived from its signature — reconnecting re-derives the same one.
            </p>
          ) : null}
          <label className="field" hidden={!!poolSigner}>
            Account private key
            <span className="row">
              <input
                className={`mono ${key && !fieldOk.key ? "invalid" : ""}`}
                type={showKey ? "text" : "password"}
                placeholder="0x… (testnet key only — stored in this browser)"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="ghost" onClick={() => setShowKey(!showKey)}>
                {showKey ? "hide" : "show"}
              </button>
            </span>
            {keyPub && (
              <span className="hint">
                this key's public key: <code>{shorten(keyPub)}</code> — match it against{" "}
                <code>public_key</code> in your sncast file to see whose key this is
              </span>
            )}
          </label>

          {fileAccounts.length > 1 && (
            <div className="field">
              Who are <strong>you</strong> in this browser?
              <div className="row" style={{ marginTop: 4 }}>
                {fileAccounts.map((a) => {
                  const selected =
                    isHex(chosenIdentity) && isHex(a.address) && BigInt(chosenIdentity) === BigInt(a.address);
                  return (
                    <button
                      key={a.name}
                      className={selected ? "primary" : ""}
                      onClick={() => {
                        // Identity = the chosen account's ADDRESS. The signer
                        // (account + key above) stays on the pool account —
                        // being someone needs their address, not their key.
                        const isSigner =
                          isHex(signerAddr) && BigInt(a.address) === BigInt(signerAddr);
                        setIdentity(isSigner ? "" : a.address);
                        setProbe(null);
                      }}
                    >
                      {a.name} <code style={{ marginLeft: 4 }}>{shorten(a.address)}</code>
                    </button>
                  );
                })}
              </div>
              <span className="hint">
                This sets your identity from that account's address — the signing key above stays
                the pool account's. A different private key does NOT change who you are.
              </span>
            </div>
          )}

          <label className="field">
            Messaging identity (optional, dev)
            <input
              className="mono"
              placeholder="0x… — leave empty to use the account address"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
            />
            <span className="hint">
              Lets several browsers share one funded signer while staying distinct people in
              threads and groups. Pool mode ignores this.
            </span>
          </label>

          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void runProbe()} disabled={!fieldOk.helper || !rpcUrl}>
              Test connection
            </button>
            {probe === "checking" && <span className="hint">checking…</span>}
            {probe && probe !== "checking" && (
              <span className={probe.ok ? "probe-ok" : "probe-err"}>{probe.detail}</span>
            )}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" disabled={!canSave} onClick={() => void save()}>
          Save & reconnect
        </button>
        {saved && <span className="probe-ok">✓ connected ({mode})</span>}
      </div>
    </div>
  );
}

/**
 * Backup and restore, and mode plumbing. Deliberately NOT here: the three
 * disclosures (they are onboarding, not settings) and any delete affordance
 * (there is nothing to delete — storage is WriteOnce).
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const cfg = store.config!;

  const download = () => {
    const blob = new Blob([store.backupJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "strk20-messages-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="ghost" onClick={onClose}>
            close
          </button>
        </div>

        <div className="settings-grid">
          <section>
            <h3>Key backup</h3>
            <p className="hint">
              The backup holds your viewing key and contacts. Message history is not included —
              it is rebuilt from the chain by sync, which is the point.
            </p>
            <div className="row">
              <button className="primary" onClick={download}>
                Download backup
              </button>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(store.backupJson());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied ✓" : "Copy to clipboard"}
              </button>
            </div>
            <p className="hint">
              To restore: install the app anywhere, choose “Restore from backup” at onboarding,
              paste this file.
            </p>
            {cfg.mode === "demo" && (
              <label className="field">
                Proving time (demo): {cfg.provingSeconds} s
                <input
                  type="range"
                  min={3}
                  max={29}
                  value={cfg.provingSeconds}
                  onChange={(e) => store.updateConnection({ provingSeconds: Number(e.target.value) })}
                />
                <span className="hint">Production proves in ~29 s. Lower this only for demos.</span>
              </label>
            )}
          </section>

          <section>
            <h3>Connection</h3>
            <ConnectionEditor onSaved={onClose} />
          </section>
        </div>
      </div>
    </div>
  );
}
