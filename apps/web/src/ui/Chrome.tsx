import { store } from "../lib/store.js";
import { shorten } from "./Onboarding.js";

/**
 * Pool mode banners, shown above the workspace. Nobody can write to you
 * until your viewing key is on the pool; sends bundle registration, but a
 * send needs a registered recipient — so the first two people would wait
 * for each other forever. Hence a registration-only transaction, offered
 * until it has happened. And the one silent failure: a registered key that
 * differs from the one in Settings — every derivation is wrong and
 * discovery simply finds nothing.
 */
export function PoolBanners() {
  if (store.isPool && store.viewingKeyMismatch) {
    return (
      <div className="register-banner mismatch">
        <span>
          <strong>Wrong viewing key for this account.</strong> The pool has a different key registered for{" "}
          <code>{shorten(store.identity)}</code> than the one in Settings. Everything derives from it, so discovery will
          find nothing and nobody can reach you — paste the key you registered with (Settings → Pool → Viewing key).
        </span>
      </div>
    );
  }
  if (!store.isPool || store.selfRegistered !== false) return null;
  const busy = store.flush.phase === "proving" || store.flush.phase === "submitted";
  return (
    <div className="register-banner">
      <span>
        <strong>Not registered on the pool yet.</strong> Until your viewing key is on the pool (<code>SetViewingKey</code>),
        nobody can write to you — one transaction, your account pays the pool fee.
      </span>
      <button type="button" className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary disabled:opacity-45" disabled={busy} onClick={() => void store.registerSelf()}>
        {busy ? "registering…" : "Register on the pool"}
      </button>
    </div>
  );
}
