import { useEffect, useSyncExternalStore, useState } from "react";
import { store } from "./lib/store.js";
import { Chrome } from "./ui/Chrome.js";
import { GroupView } from "./ui/GroupView.js";
import { Onboarding } from "./ui/Onboarding.js";
import { OutboxBar } from "./ui/OutboxBar.js";
import { Settings } from "./ui/Settings.js";
import { Sidebar } from "./ui/Sidebar.js";
import { ThreadView } from "./ui/ThreadView.js";

export function App() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Wallet mode without a helper address (mainnet, before deployment) has
  // nowhere to write: open Settings so the gap is visible, not silent.
  const needsSetup = store.config?.onboarded === true && store.config.mode === "wallet" && !store.config.helperAddress;
  useEffect(() => {
    if (needsSetup) setShowSettings(true);
  }, [needsSetup]);

  if (!store.config?.onboarded) return <Onboarding />;

  const activeGroup = activeLabel?.startsWith("#")
    ? store.groupByName(activeLabel.slice(1))
    : undefined;
  const activeContact = !activeGroup
    ? (store.contacts.find((c) => c.label === activeLabel) ?? store.contacts[0] ?? null)
    : null;
  const activeId = activeGroup ? `#${activeGroup.name}` : (activeContact?.label ?? null);

  return (
    <div className="app">
      <Chrome onSettings={() => setShowSettings(true)} />
      <div className="body">
        <Sidebar active={activeId} onSelect={setActiveLabel} />
        <main className="thread-pane">
          {activeGroup ? (
            <GroupView group={activeGroup} />
          ) : activeContact ? (
            <ThreadView contact={activeContact} />
          ) : (
            <div className="empty-state">
              <h2>No conversations yet</h2>
              <p>Add a contact or create a group. Messages are end-to-end encrypted and permanent.</p>
            </div>
          )}
        </main>
      </div>
      <OutboxBar />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
