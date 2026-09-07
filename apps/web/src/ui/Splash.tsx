import { useEffect, useState } from "react";

const SPLASH_MS = 2200;

/**
 * Brand splash shown once on cold start before onboarding terms or the app shell.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduced ? 600 : SPLASH_MS;
    const fadeAt = Math.max(0, total - (reduced ? 150 : 400));
    const fade = window.setTimeout(() => setFadeOut(true), fadeAt);
    const done = window.setTimeout(onDone, total);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`flex h-full min-h-full flex-col items-center justify-center bg-background px-6 transition-opacity duration-[400ms] ease-out ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading VeruShield Connect"
    >
      <img
        src="/verushield-logo.svg"
        alt=""
        width={128}
        height={128}
        className="h-28 w-28 rounded-2xl object-cover shadow-lg motion-safe:animate-pulse sm:h-32 sm:w-32"
        draggable={false}
      />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">VeruShield</h1>
      <p className="label-caps mt-1 text-primary">Connect Protocol</p>
      <p className="mt-2 text-sm text-muted-foreground">Private messaging on Starknet</p>
      <div
        className="mt-8 h-1 w-28 overflow-hidden rounded-full bg-border"
        aria-hidden="true"
      >
        <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-[splash-bar_1.4s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
