import { CaretLeft, CaretRight, ChatCircle, Copy, GearSix, Key, ShieldCheck, SignOut, SlidersHorizontal, User, ArrowsClockwise } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

export type AppRoute = "conversations" | "tradeoffs" | "compliance" | "settings";

const RAIL_KEY = "verushield.rail.expanded";

/** The network the connection points at, from the RPC URL — what the chips show. */
export function networkLabel(): string {
  const cfg = store.config;
  if (!cfg || cfg.mode === "demo") return "demo";
  if (cfg.poolLocal) return "devnet";
  const rpc = (cfg.rpcUrl ?? "").toLowerCase();
  if (rpc.includes("mainnet")) return "mainnet";
  if (rpc.includes("sepolia")) return "Sepolia";
  if (/localhost|127\.0\.0\.1/.test(rpc)) return "local";
  return "custom RPC";
}

export function modeLabel(): string {
  const cfg = store.config;
  if (!cfg) return "—";
  switch (cfg.mode) {
    case "demo":
      return "Demo · simulated pool";
    case "wallet":
      return `Wallet · ${cfg.walletId ?? "wallet"} proves`;
    case "pool":
      return cfg.accountKey ? "Pool · app prover" : "Pool · app prover, wallet signs";
    case "direct":
      return "Direct · dev helper";
    default:
      return cfg.mode;
  }
}

export function WorkspaceShell({
  route,
  onRoute,
  children,
  identity,
  lockedRoutes,
  footer,
  banner,
  onSettings,
  onDisconnect,
}: {
  route: AppRoute;
  onRoute: (r: AppRoute) => void;
  children: ReactNode;
  /** Shown in the identity card; falls back to the store when onboarded. */
  identity?: string | null;
  /** Routes not available yet (e.g. conversations during onboarding). */
  lockedRoutes?: AppRoute[];
  footer?: ReactNode;
  banner?: ReactNode;
  onSettings?: () => void;
  onDisconnect?: () => void;
}) {
  const locked = new Set(lockedRoutes ?? []);
  const connected = Boolean(store.config?.onboarded);
  const addr = identity ?? (connected ? store.identity : null);
  const [expanded, setExpanded] = useState(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY);
      return v === null ? true : v === "1";
    } catch {
      return true;
    }
  });

  const toggleRail = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const openSettings = () => {
    if (onSettings) onSettings();
    else onRoute("settings");
  };

  const registered = store.isPool ? store.selfRegistered : connected ? true : null;

  return (
    <div className="flex h-full bg-surface text-foreground">
      <aside
        className={`hidden h-full shrink-0 flex-col justify-between border-r border-border bg-surface-lowest shadow-[0_1px_8px_rgba(0,0,0,0.65)] transition-[width] duration-200 ease-out md:flex ${
          expanded ? "w-sidebar" : "w-sidebar-collapsed"
        }`}
        aria-label="Navigation"
        data-expanded={expanded}
      >
        <div className={`flex flex-col gap-4 ${expanded ? "p-4" : "items-center p-2"}`}>
          <div className={`flex items-center ${expanded ? "gap-2.5 px-1 py-1" : "justify-center py-2"}`}>
            <img src={`${import.meta.env.BASE_URL}verushield-logo.svg`} alt="VeruShield Connect" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" draggable={false} />
            {expanded && (
              <div className="flex min-w-0 flex-col leading-none">
                <span className="truncate text-lg font-semibold tracking-tight text-foreground">VeruShield</span>
                <span className="mono-sm tracking-wider text-muted-foreground uppercase">Connect // Starknet</span>
              </div>
            )}
          </div>

          {expanded ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-low p-3">
              <div className="flex items-center justify-between">
                <span className="label-caps text-muted-foreground">Your address</span>
                <span className={`h-2 w-2 rounded-full ${registered === false ? "bg-warn" : "bg-primary"} ${registered ? "animate-[pulse-dot_1.6s_ease-in-out_infinite]" : ""}`} aria-hidden="true" />
              </div>
              <button
                type="button"
                className="mono-sm flex w-full items-center gap-1.5 truncate text-left text-secondary"
                title={addr ? `${addr}\nclick to copy — this is what others add to reach you` : "No identity yet"}
                onClick={() => addr && void navigator.clipboard.writeText(addr)}
              >
                <span className="truncate">{addr ? shorten(addr) : "not created yet"}</span>
                {addr && <Copy size={12} aria-hidden="true" />}
              </button>
              <div className="flex items-center gap-1.5">
                <span className="label-caps text-muted-foreground">Pool key:</span>
                <span className="mono-sm truncate text-muted-foreground">
                  {registered === null ? "—" : registered ? "registered" : "not registered"}
                </span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-surface-low text-primary"
              title={addr ? `Your address ${shorten(addr)} — click to copy` : "No identity yet"}
              onClick={() => addr && void navigator.clipboard.writeText(addr)}
            >
              <ShieldCheck size={20} weight="duotone" aria-hidden="true" />
            </button>
          )}

          <nav className={`flex flex-col gap-0.5 ${expanded ? "" : "w-full items-center"}`}>
            <NavItem expanded={expanded} label="Conversations" icon={<ChatCircle size={20} weight={route === "conversations" ? "fill" : "regular"} />} active={route === "conversations"} locked={locked.has("conversations")} onClick={() => onRoute("conversations")} />
            <NavItem expanded={expanded} label="Privacy trade-offs" icon={<SlidersHorizontal size={20} weight={route === "tradeoffs" ? "fill" : "regular"} />} active={route === "tradeoffs"} locked={locked.has("tradeoffs")} onClick={() => onRoute("tradeoffs")} />
            <NavItem expanded={expanded} label="Compliance disclosure" icon={<Key size={20} weight={route === "compliance" ? "fill" : "regular"} />} active={route === "compliance"} locked={locked.has("compliance")} onClick={() => onRoute("compliance")} />
            <NavItem expanded={expanded} label="Settings" icon={<GearSix size={20} weight={route === "settings" ? "fill" : "regular"} />} active={route === "settings"} locked={locked.has("settings") || !connected} onClick={() => openSettings()} />
          </nav>
        </div>

        <div className={`flex flex-col gap-2 ${expanded ? "p-4 pt-0" : "items-center p-2"}`}>
          {expanded ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-low p-3">
              <div className="flex items-center justify-between">
                <span className="label-caps text-muted-foreground">Connection</span>
                <span className="mono-sm text-primary">{networkLabel()}</span>
              </div>
              <span className="mono-sm text-foreground">{connected ? modeLabel() : "not connected"}</span>
              {store.config?.poolAddress && (
                <div className="flex items-center justify-between mono-sm text-muted-foreground">
                  <span>Pool</span>
                  <span title={store.config.poolAddress}>{shorten(store.config.poolAddress)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-low" title={`${modeLabel()} · ${networkLabel()}`}>
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
            </div>
          )}

          <button
            type="button"
            className={`flex items-center rounded-lg border border-border bg-surface-low text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground ${
              expanded ? "justify-between gap-2 px-3 py-2" : "h-10 w-10 justify-center"
            }`}
            onClick={toggleRail}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded && <span className="mono-sm">Collapse rail</span>}
            {expanded ? <CaretLeft size={16} weight="bold" aria-hidden="true" /> : <CaretRight size={16} weight="bold" aria-hidden="true" />}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopStatusBar connected={connected} onSettings={openSettings} onDisconnect={onDisconnect} />
        {banner}
        <div className="flex min-h-0 flex-1">{children}</div>
        {footer ?? <StatusFooter />}
      </div>
    </div>
  );
}

function NavItem({ label, icon, active, locked, expanded, onClick }: { label: string; icon: ReactNode; active: boolean; locked?: boolean; expanded: boolean; onClick: () => void }) {
  const activeCls = "bg-primary font-medium text-on-primary";
  const idleCls = locked ? "cursor-not-allowed text-outline/50" : "text-muted-foreground hover:bg-surface-high hover:text-foreground";
  if (!expanded) {
    return (
      <button type="button" disabled={locked} aria-current={active ? "page" : undefined} aria-label={label} title={label} className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all ${active ? activeCls : idleCls}`} onClick={onClick}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" disabled={locked} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${active ? activeCls : idleCls}`} onClick={onClick}>
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function TopStatusBar({ connected, onSettings, onDisconnect }: { connected: boolean; onSettings: () => void; onDisconnect?: () => void }) {
  const [, tick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    // Auto-sync: incoming messages appear without hunting for a button. A
    // stale view rendering as "no new messages" is the failure mode to avoid.
    const s = setInterval(() => {
      if (store.config?.onboarded) void store.syncNow();
    }, 15000);
    const b = setInterval(() => {
      if (store.config?.onboarded) void store.refreshBalance();
    }, 30000);
    return () => {
      clearInterval(t);
      clearInterval(s);
      clearInterval(b);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDisconnect(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmDisconnect(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const status = store.engine?.status();
  const age = status?.updatedAt != null ? Math.max(0, Math.round((Date.now() - status.updatedAt) / 1000)) : null;
  const cfg = store.config;
  const bal = store.strkBalance;
  const need = (store.poolFee ?? 0) + 3;
  const low = cfg?.mode === "pool" && bal !== null && bal < need;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-lowest/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.4)] backdrop-blur-xl lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center gap-1.5 rounded bg-surface-low px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="mono-sm text-foreground">{connected ? modeLabel() : "VeruShield Connect"}</span>
        </div>
        <div className="hidden items-center gap-1.5 rounded bg-surface-low px-2.5 py-1 sm:flex">
          <span className="label-caps text-muted-foreground">Network</span>
          <span className="mono-sm text-secondary">{networkLabel()}</span>
        </div>
        {connected && cfg?.mode !== "demo" && (
          <button
            type="button"
            className={`hidden items-center gap-1.5 rounded px-2.5 py-1 lg:flex ${low ? "bg-warn-bg text-warn" : "bg-surface-low"}`}
            title={
              bal === null
                ? "reading your STRK balance…"
                : cfg?.mode === "pool"
                  ? `${bal.toLocaleString()} STRK on ${cfg.accountAddress}\npool fee ${store.poolFee ?? "?"} STRK per transaction + ~2.5 STRK gas per send${low ? " — too low to send, top up" : ""}`
                  : `${bal.toLocaleString()} STRK on ${cfg?.accountAddress}`
            }
            onClick={() => void store.refreshBalance()}
          >
            <span className="label-caps text-muted-foreground">STRK</span>
            <span className="mono-sm">{bal === null ? "…" : bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}{low ? " · low" : ""}</span>
          </button>
        )}
        {connected && (
          <button
            type="button"
            className={`hidden items-center gap-1.5 rounded px-2.5 py-1 xl:flex ${store.syncing ? "bg-primary/10 text-primary" : "bg-surface-low text-muted-foreground hover:text-foreground"}`}
            onClick={() => void store.syncNow()}
            title="Click to sync now"
          >
            <ArrowsClockwise size={12} className={store.syncing ? "animate-spin" : ""} aria-hidden="true" />
            <span className="mono-sm">
              {store.syncing ? "syncing…" : status?.syncedToBlock != null ? `block ${status.syncedToBlock.toLocaleString()} · ${age}s ago` : "not synced yet"}
            </span>
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {connected && (
          <>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full bg-surface-low px-2.5 py-1 hover:bg-surface-high"
              title={`your address — click to copy:\n${store.identity}`}
              onClick={() => {
                void navigator.clipboard.writeText(store.identity);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <ShieldCheck size={14} className="text-primary" aria-hidden="true" />
              <span className="mono-sm text-foreground">{copied ? "copied ✓" : shorten(store.identity)}</span>
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className={`flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity hover:opacity-90 ${menuOpen ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-surface-lowest" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                onClick={() => {
                  setMenuOpen((o) => !o);
                  setConfirmDisconnect(false);
                }}
              >
                <User size={16} weight="fill" aria-hidden="true" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-border-strong bg-surface-mid shadow-[0px_8px_24px_rgba(0,0,0,0.65)]">
                  <div className="optical-rail" />
                  <div className="border-b border-border px-3 py-2">
                    <div className="label-caps text-muted-foreground">Your address</div>
                    <div className="mono-sm mt-0.5 truncate text-secondary">{store.identity ? shorten(store.identity) : "—"}</div>
                    <div className="mono-sm mt-0.5 text-muted-foreground">{modeLabel()} · {networkLabel()}</div>
                  </div>
                  <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-high" onClick={() => { setMenuOpen(false); onSettings(); }}>
                    <GearSix size={16} aria-hidden="true" />
                    Settings
                  </button>
                  {!confirmDisconnect ? (
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10" onClick={() => setConfirmDisconnect(true)} disabled={!onDisconnect}>
                      <SignOut size={16} aria-hidden="true" />
                      Disconnect
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1 border-t border-border bg-destructive/5 p-2">
                      <p className="px-1 text-xs text-muted-foreground">Clear keys, contacts and local state from this browser? Download a backup first.</p>
                      <button type="button" role="menuitem" className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-on-destructive hover:opacity-90" onClick={() => { setMenuOpen(false); setConfirmDisconnect(false); onDisconnect?.(); }}>
                        Yes, disconnect
                      </button>
                      <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setConfirmDisconnect(false)}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export function StatusFooter() {
  const status = store.engine?.status();
  const cfg = store.config;
  return (
    <footer className="flex shrink-0 flex-col gap-1 border-t border-border bg-surface-lowest/95 px-4 py-2 backdrop-blur-md md:flex-row md:items-center md:justify-between lg:px-6">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${store.syncing ? "animate-pulse bg-secondary" : "bg-primary"}`} />
        <span className="mono-sm">
          {cfg?.onboarded ? (store.syncing ? "scanning your lanes…" : "sync idle · runs every 15 s") : "not connected"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="mono-sm text-muted-foreground">
          Storage: <strong className="font-medium text-foreground">write-once, permanent</strong>
        </span>
        {status?.syncedToBlock != null && (
          <span className="mono-sm text-muted-foreground">
            Block: <span className="text-secondary">{status.syncedToBlock.toLocaleString()}</span>
          </span>
        )}
        <span className="mono-sm rounded bg-surface-low px-1.5 py-0.5 font-medium text-primary">{networkLabel()}</span>
      </div>
    </footer>
  );
}
