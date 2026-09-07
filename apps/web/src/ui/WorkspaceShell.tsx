import {
  CaretLeft,
  CaretRight,
  ChatCircle,
  GearSix,
  Key,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  User,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

export type AppRoute = "conversations" | "tradeoffs" | "compliance" | "settings";

const RAIL_KEY = "verushield.rail.expanded";

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
  /** Shown in the shielded-identity card; falls back to store when onboarded. */
  identity?: string | null;
  /** Routes that are not yet available (e.g. conversations during onboarding). */
  lockedRoutes?: AppRoute[];
  footer?: ReactNode;
  banner?: ReactNode;
  /** Opens Privacy Settings. Only used when connected. */
  onSettings?: () => void;
  /** Clears local session. Only used when connected. */
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

  return (
    <div className="flex h-full bg-surface text-foreground">
      {/* Column 1 — Operational routes (expand / collapse → icon rail) */}
      <aside
        className={`hidden h-full shrink-0 flex-col justify-between border-r border-border bg-surface-lowest shadow-[0_1px_8px_rgba(0,0,0,0.65)] transition-[width] duration-200 ease-out md:flex ${
          expanded ? "w-sidebar" : "w-sidebar-collapsed"
        }`}
        aria-label="Operational routes"
        data-expanded={expanded}
      >
        <div className={`flex flex-col gap-4 ${expanded ? "p-4" : "items-center p-2"}`}>
          {/* Brand */}
          <div
            className={`flex items-center ${
              expanded ? "gap-2.5 px-1 py-1" : "justify-center py-2"
            }`}
          >
            <img
              src="/verushield-logo.svg"
              alt="VeruShield Connect"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-contain"
              draggable={false}
            />
            {expanded && (
              <div className="flex min-w-0 flex-col leading-none">
                <span className="truncate text-lg font-semibold tracking-tight text-foreground">
                  VeruShield
                </span>
                <span className="mono-sm tracking-wider text-muted-foreground uppercase">
                  Connect // Starknet
                </span>
              </div>
            )}
          </div>

          {/* Shielded identity — escrow design places this above nav */}
          {expanded ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-low p-3">
              <div className="flex items-center justify-between">
                <span className="label-caps text-muted-foreground">Shielded Identity</span>
                <span
                  className="h-2 w-2 animate-[pulse-dot_1.6s_ease-in-out_infinite] rounded-full bg-primary"
                  aria-hidden="true"
                />
              </div>
              <button
                type="button"
                className="mono-sm w-full truncate text-left text-secondary select-all"
                title={addr ?? "Not registered"}
                onClick={() => addr && void navigator.clipboard.writeText(addr)}
              >
                {addr ? shorten(addr) : "Awaiting registration…"}
              </button>
              <div className="flex items-center gap-1.5">
                <span className="label-caps text-muted-foreground">Commitment:</span>
                <span className="mono-sm truncate text-muted-foreground">
                  {addr ? `${addr.slice(2, 8)}…zk` : "—"}
                </span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-surface-low text-primary"
              title={addr ? `Shielded identity ${shorten(addr)}` : "Awaiting registration"}
              onClick={() => addr && void navigator.clipboard.writeText(addr)}
            >
              <ShieldCheck size={20} weight="duotone" aria-hidden="true" />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
            </button>
          )}

          <nav className={`flex flex-col gap-0.5 ${expanded ? "" : "items-center w-full"}`}>
            <NavItem
              expanded={expanded}
              label="Conversations"
              icon={<ChatCircle size={20} weight={route === "conversations" ? "fill" : "regular"} />}
              active={route === "conversations"}
              locked={locked.has("conversations")}
              onClick={() => onRoute("conversations")}
            />
            <NavItem
              expanded={expanded}
              label="Trade-off Config"
              icon={<SlidersHorizontal size={20} weight={route === "tradeoffs" ? "fill" : "regular"} />}
              active={route === "tradeoffs"}
              locked={locked.has("tradeoffs")}
              onClick={() => onRoute("tradeoffs")}
            />
            <NavItem
              expanded={expanded}
              label="Compliance Disclosure"
              icon={<Key size={20} weight={route === "compliance" ? "fill" : "regular"} />}
              active={route === "compliance"}
              locked={locked.has("compliance")}
              onClick={() => onRoute("compliance")}
            />
            <NavItem
              expanded={expanded}
              label="Settings"
              icon={<ShieldCheck size={20} weight={route === "settings" ? "fill" : "regular"} />}
              active={route === "settings"}
              locked={locked.has("settings") || !connected}
              onClick={() => openSettings()}
            />
          </nav>
        </div>

        <div className={`flex flex-col gap-2 ${expanded ? "p-4 pt-0" : "items-center p-2"}`}>
          {expanded ? (
            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-low p-3">
              <div className="flex items-center justify-between">
                <span className="label-caps text-muted-foreground">Pool Status</span>
                <span className="mono-sm text-primary">ONLINE</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-highest">
                <div className="h-full w-4/5 bg-primary" />
              </div>
              <div className="flex items-center justify-between mono-sm text-muted-foreground">
                <span>Sync Delay</span>
                <span>12ms (SN-L2)</span>
              </div>
            </div>
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-low"
              title="Pool status: ONLINE"
            >
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
            {expanded ? (
              <CaretLeft size={16} weight="bold" aria-hidden="true" />
            ) : (
              <CaretRight size={16} weight="bold" aria-hidden="true" />
            )}
          </button>
        </div>
      </aside>

      {/* Main column stack */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopStatusBar
          connected={connected}
          onSettings={openSettings}
          onDisconnect={onDisconnect}
        />
        {banner}
        <div className="flex min-h-0 flex-1">{children}</div>
        {footer ?? <StatusFooter />}
      </div>
    </div>
  );
}

function NavItem({
  label,
  icon,
  active,
  locked,
  expanded,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  locked?: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  // Escrow design active: primary-container fill + on-primary-container ink
  const activeCls = "bg-primary font-medium text-on-primary";
  const idleCls = locked
    ? "cursor-not-allowed text-outline/50"
    : "text-muted-foreground hover:bg-surface-high hover:text-foreground";

  if (!expanded) {
    return (
      <button
        type="button"
        disabled={locked}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={label}
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
          active ? activeCls : idleCls
        }`}
        onClick={onClick}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={locked}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
        active ? activeCls : idleCls
      }`}
      onClick={onClick}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function TopStatusBar({
  connected,
  onSettings,
  onDisconnect,
}: {
  connected: boolean;
  onSettings: () => void;
  onDisconnect?: () => void;
}) {
  const [, tick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const s = setInterval(() => {
      if (store.config?.onboarded) void store.syncNow();
    }, 15000);
    return () => {
      clearInterval(t);
      clearInterval(s);
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
  const latencyHint = store.syncing ? "scanning…" : status?.syncedToBlock != null ? "live" : "idle";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-lowest/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.4)] backdrop-blur-xl lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-1.5 rounded bg-surface-low px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="mono-sm text-foreground">Privacy Pool V0.1</span>
        </div>
        <div className="hidden items-center gap-1.5 rounded bg-surface-low px-2.5 py-1 lg:flex">
          <span className="label-caps text-muted-foreground">Escrow Key:</span>
          <span className="mono-sm text-secondary">#8f32…c91</span>
        </div>
        <div className="hidden items-center gap-1.5 rounded bg-surface-low px-2.5 py-1 xl:flex">
          <span className="label-caps text-muted-foreground">WASM ZK:</span>
          <span className="mono-sm text-primary">{latencyHint}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {connected && (
          <>
            <div className="flex items-center gap-1.5 rounded-full bg-surface-low px-2.5 py-1">
              <ShieldCheck size={14} className="text-primary" aria-hidden="true" />
              <span className="label-caps text-foreground">Shielded Active</span>
            </div>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className={`flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity hover:opacity-90 ${
                  menuOpen ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-surface-lowest" : ""
                }`}
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
                <div
                  role="menu"
                  className="absolute top-full right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border-strong bg-surface-mid shadow-[0px_8px_24px_rgba(0,0,0,0.65)]"
                >
                  <div className="optical-rail" />
                  <div className="border-b border-border px-3 py-2">
                    <div className="label-caps text-muted-foreground">Shielded Identity</div>
                    <div className="mono-sm mt-0.5 truncate text-secondary">
                      {store.identity ? shorten(store.identity) : "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-high"
                    onClick={() => {
                      setMenuOpen(false);
                      onSettings();
                    }}
                  >
                    <GearSix size={16} aria-hidden="true" />
                    Settings
                  </button>
                  {!confirmDisconnect ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDisconnect(true)}
                      disabled={!onDisconnect}
                    >
                      <SignOut size={16} aria-hidden="true" />
                      Disconnect
                    </button>
                  ) : (
                    <div className="flex flex-col gap-1 border-t border-border bg-destructive/5 p-2">
                      <p className="px-1 text-xs text-muted-foreground">
                        Clear keys and local state from this browser?
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-lg bg-destructive px-3 py-2 text-sm font-semibold text-on-destructive hover:opacity-90"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDisconnect(false);
                          onDisconnect?.();
                        }}
                      >
                        Yes, disconnect
                      </button>
                      <button
                        type="button"
                        className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setConfirmDisconnect(false)}
                      >
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
  const syncPct =
    status?.syncedToBlock != null ? 100 : store.syncing ? 72 : store.config?.onboarded ? 100 : 0;

  return (
    <footer className="flex shrink-0 flex-col gap-1 border-t border-border bg-surface-lowest/95 px-4 py-2 backdrop-blur-md md:flex-row md:items-center md:justify-between lg:px-6">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="mono-sm">
          ZK Proof Engine: <span className="text-primary">STARK-Verifier OK</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="mono-sm text-muted-foreground">
          Pool size: <strong className="font-medium text-foreground">demo commitments</strong>
        </span>
        {status?.syncedToBlock != null && (
          <span className="mono-sm text-muted-foreground">
            Block: <span className="text-secondary">{status.syncedToBlock.toLocaleString()}</span>
          </span>
        )}
        <span className="mono-sm rounded bg-surface-low px-1.5 py-0.5 font-medium text-primary">
          Sync {syncPct}%
        </span>
      </div>
    </footer>
  );
}

/** Optional degradation banner matching the chat-proving screen (demo / relay hint). */
export function PaymasterBanner({
  visible,
  onDirect,
  onRetry,
}: {
  visible: boolean;
  onDirect: () => void;
  onRetry: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="flex flex-col items-start justify-between gap-2 border-b border-destructive/20 bg-destructive-container/40 px-4 py-2.5 backdrop-blur-md md:flex-row md:items-center lg:px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-destructive/20 text-destructive">
          !
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-lg font-medium leading-none text-destructive">
              Paymaster Relay Unreachable
            </span>
            <span className="mono-sm rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
              Degraded Circuit
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            The third-party relayer is experiencing high congestion or latency timeout.
          </p>
        </div>
      </div>
      <div className="flex w-full shrink-0 items-center gap-2 md:w-auto">
        <button
          type="button"
          className="flex-1 rounded-lg bg-surface-high px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-surface-highest hover:text-foreground md:flex-initial"
          onClick={onDirect}
        >
          Submit directly (address visible on Starknet)
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90 md:flex-initial"
          onClick={onRetry}
        >
          Retry relay
        </button>
      </div>
    </div>
  );
}
