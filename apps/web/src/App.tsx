import { useCallback, useSyncExternalStore, useState } from "react";
import { store } from "./lib/store.js";
import { GroupView } from "./ui/GroupView.js";
import { Onboarding } from "./ui/Onboarding.js";
import { OutboxBar } from "./ui/OutboxBar.js";
import { Settings } from "./ui/Settings.js";
import { Sidebar } from "./ui/Sidebar.js";
import { Splash } from "./ui/Splash.js";
import { ThreadView } from "./ui/ThreadView.js";
import { TradeoffsPanel } from "./ui/TradeoffsPanel.js";
import {
  WorkspaceShell,
  type AppRoute,
} from "./ui/WorkspaceShell.js";

export function App() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<AppRoute>("conversations");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);

  const finishSplash = useCallback(() => setBooting(false), []);

  if (booting) return <Splash onDone={finishSplash} />;

  if (!store.config?.onboarded) return <Onboarding />;

  const activeGroup = activeLabel?.startsWith("#")
    ? store.groupByName(activeLabel.slice(1))
    : undefined;
  const activeContact = !activeGroup
    ? (store.contacts.find((c) => c.label === activeLabel) ?? store.contacts[0] ?? null)
    : null;
  const activeId = activeGroup ? `#${activeGroup.name}` : (activeContact?.label ?? null);
  const hasThread = Boolean(activeGroup || activeContact);

  const selectConversation = (label: string) => {
    setActiveLabel(label);
    setMobileThreadOpen(true);
    setRoute("conversations");
  };

  const backToList = () => setMobileThreadOpen(false);

  const onRoute = (r: AppRoute) => {
    if (r === "settings") {
      setShowSettings(true);
      return;
    }
    setRoute(r);
    if (r !== "conversations") setMobileThreadOpen(false);
  };

  return (
    <WorkspaceShell
      route={route === "settings" ? "conversations" : route}
      onRoute={onRoute}
      onSettings={() => setShowSettings(true)}
      onDisconnect={() => store.disconnect()}
      footer={
        <div className="shrink-0">
          <OutboxBar compact />
        </div>
      }
    >
      {route === "tradeoffs" ? (
        <TradeoffsPanel />
      ) : route === "compliance" ? (
        <ComplianceReadOnly onTradeoffs={() => setRoute("tradeoffs")} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div
            className={`h-full w-full shrink-0 md:block md:w-auto ${
              mobileThreadOpen ? "hidden" : "block"
            }`}
          >
            <Sidebar active={activeId} onSelect={selectConversation} />
          </div>
          <main
            className={`min-w-0 flex-1 ${
              mobileThreadOpen || !hasThread ? "flex" : "hidden md:flex"
            }`}
          >
            {activeGroup ? (
              <GroupView group={activeGroup} onBack={backToList} />
            ) : activeContact ? (
              <ThreadView
                contact={activeContact}
                onBack={backToList}
                onPrivacy={() => setShowSettings(true)}
              />
            ) : (
              <div className="m-auto max-w-sm px-6 text-center text-muted-foreground">
                <h2 className="text-lg font-semibold text-foreground">No channels yet</h2>
                <p className="mt-2 text-sm">
                  Add a nickname for someone you know. We check your channels locally for new
                  messages — nothing is stored elsewhere.
                </p>
              </div>
            )}
          </main>
        </div>
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </WorkspaceShell>
  );
}

function ComplianceReadOnly({ onTradeoffs }: { onTradeoffs: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-8 lg:px-10 lg:py-10">
      <div className="w-full rounded-xl bg-surface-lowest p-8 shadow-2xl lg:p-10">
        <div className="optical-rail mb-6" />
        <span className="label-caps text-secondary">Cryptographic Escrow Architecture</span>
        <h1 className="mt-2 max-w-4xl text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-10">
          Your messages are private from everyone{" "}
          <span className="text-primary">except a designated auditor</span>
        </h1>
        <p className="mt-4 max-w-4xl text-sm leading-relaxed text-muted-foreground lg:text-base">
          STRK20 escrows every user&apos;s private viewing key, encrypted to an auditor&apos;s
          public key, on chain at registration. An auditor holding lawful process can recover that
          key and read your history. This is not built for anonymous tips or dissident
          communication.
        </p>
        <p className="mt-3 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">
          Messages are permanent WriteOnce payloads. Observers see size and timing metadata only —
          except the designated auditor under lawful process.
        </p>
        <button
          type="button"
          className="mt-6 rounded-lg bg-primary px-4 py-2.5 font-semibold text-on-primary"
          onClick={onTradeoffs}
        >
          Review Trade-off Config
        </button>
      </div>
    </div>
  );
}
