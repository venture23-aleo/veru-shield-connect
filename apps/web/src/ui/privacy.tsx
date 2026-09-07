/**
 * Shared privacy tip — auditor caveat travels with compose and settings (UX §3 / §5).
 */
import { Info, Lock } from "@phosphor-icons/react";
import { useState } from "react";

export function PrivacyLockTip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}
      title="Encrypted end-to-end. Visible to a lawful-process auditor."
    >
      <Lock size={14} weight="regular" className="text-primary" aria-hidden="true" />
      Encrypted end-to-end. Visible to a lawful-process auditor.
    </span>
  );
}

export function PrivacyInfoButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
      aria-label="Privacy details"
      title="Privacy details"
      onClick={onOpen}
    >
      <Info size={16} weight="regular" aria-hidden="true" />
    </button>
  );
}

export function relativeTime(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function SendStatusChip({
  status,
  provingLabel,
}: {
  status: string;
  provingLabel?: string;
}) {
  const label =
    status === "queued"
      ? "Queued"
      : status === "encrypting"
        ? "Encrypting"
        : status === "proving"
          ? provingLabel ?? "Generating proof"
          : status === "submitted"
            ? "Submitting"
            : status === "confirmed"
              ? "Confirmed"
              : status === "failed"
                ? "Failed — retry"
                : status;
  const tone =
    status === "confirmed"
      ? "border-ok text-ok"
      : status === "failed"
        ? "border-destructive text-destructive"
        : status === "proving" || status === "encrypting" || status === "submitted"
          ? "border-primary text-primary"
          : "border-border text-muted-foreground";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
  );
}

/** Tiny determinate-feeling bar under a pending bubble (UX §5). */
export function BubbleProgress({ phase, pct }: { phase: string; pct: number }) {
  if (phase === "queued" || phase === "confirmed" || phase === "failed") return null;
  return (
    <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-primary/20" aria-hidden="true">
      <div className="h-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function usePrivacySheet() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
