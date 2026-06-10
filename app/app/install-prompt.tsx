"use client";

import { useEffect, useState } from "react";

/**
 * InstallPrompt — a small, dismissible "add this to your home screen"
 * banner shown on /app to first-time mobile visitors who haven't yet
 * installed the PWA. Platform-aware:
 *
 *   • iOS (no programmatic install API): tells the parent to tap Share
 *     → Add to Home Screen. Detected via UA + lack of standalone.
 *   • Chrome / Edge / Samsung Internet on Android: catches the
 *     `beforeinstallprompt` event, stashes it, and offers a one-tap
 *     "Install" button that triggers the native install flow.
 *   • Desktop / already-installed PWA: renders nothing.
 *
 * Dismissal is persisted in localStorage so the banner doesn't badger
 * a parent who's seen it once and isn't ready to install yet.
 */
export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android-prompt" | "ios-no-safari" | null>(null);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed → don't bother.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS-specific: navigator.standalone is true in installed PWAs
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    // Parent already dismissed → respect that.
    try {
      if (localStorage.getItem("bt_install_dismissed") === "1") return;
    } catch {
      /* private mode etc — fail open and show the banner */
    }

    const ua = navigator.userAgent;
    const isIOS = /iP(hone|od|ad)/.test(ua);
    const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    if (isIOS && isSafari) {
      setPlatform("ios");
      setShow(true);
    } else if (isIOS) {
      // Chrome / Firefox / Edge on iOS can't install PWAs — only Safari can.
      setPlatform("ios-no-safari");
      setShow(true);
    }
    // Android & desktop Chrome — wait for the install-prompt event.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      setPlatform("android-prompt");
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    // Hide ourselves if the parent installs via the browser's UI.
    const onInstalled = () => setShow(false);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem("bt_install_dismissed", "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  async function install() {
    if (!deferredEvent) return;
    deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    if (choice.outcome === "accepted") setShow(false);
    // If dismissed, leave the banner up so the parent can change their
    // mind — they'll dismiss explicitly with the X if they don't want it.
    setDeferredEvent(null);
  }

  if (!show) return null;
  return (
    <div className="relative rounded-2xl border border-[var(--color-rule)] bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid size-7 place-items-center rounded-full text-[var(--color-ink-soft)] transition hover:bg-[var(--color-rule)]/40"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="size-4"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-cream)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={32} height={32} className="size-7 rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--color-ink)]">
            Install Braintech on your phone
          </div>
          <PlatformInstructions platform={platform} onInstall={install} />
        </div>
      </div>
    </div>
  );
}

function PlatformInstructions({
  platform,
  onInstall,
}: {
  platform: "ios" | "android-prompt" | "ios-no-safari" | null;
  onInstall: () => void;
}) {
  if (platform === "android-prompt") {
    return (
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm text-[var(--color-ink-soft)]">
          One tap — opens like an app, no browser bar.
        </p>
        <button
          type="button"
          onClick={onInstall}
          className="self-start rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)] sm:ml-auto"
        >
          Install
        </button>
      </div>
    );
  }
  if (platform === "ios") {
    return (
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Tap the{" "}
        <ShareIcon />{" "}
        <span className="font-medium">Share</span> button at the bottom of
        Safari, then{" "}
        <span className="font-medium">Add to Home Screen</span>.
      </p>
    );
  }
  if (platform === "ios-no-safari") {
    return (
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        On iPhone you&rsquo;ll need to open this page in{" "}
        <span className="font-medium">Safari</span> to install — only
        Safari can add web apps to your home screen.
      </p>
    );
  }
  return null;
}

function ShareIcon() {
  // Apple's share-sheet glyph — recognisable enough that parents know
  // which button we mean. Inline so it sits on the line with the text.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline size-4 align-text-bottom text-[var(--color-accent)]"
      aria-label="Share"
    >
      <path d="M12 3v13" />
      <path d="M8 7l4-4 4 4" />
      <rect x="4" y="11" width="16" height="10" rx="2" />
    </svg>
  );
}

// Augmenting the global Window type for the install-prompt event isn't
// in lib.dom by default. Minimal local declaration so TS stops complaining.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
