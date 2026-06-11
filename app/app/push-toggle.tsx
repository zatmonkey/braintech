"use client";

/**
 * Enable / disable Web Push for this PWA install. Sits in the /app
 * header. Three states:
 *   - unsupported  → render nothing (no notification API)
 *   - default      → show "🔔 Enable" — click triggers permission prompt
 *   - granted+sub  → show "🔔 On" with a click to unsubscribe
 *   - denied       → show muted "Blocked" hint
 *
 * Permission flow:
 *   1. Notification.requestPermission()
 *   2. navigator.serviceWorker.ready
 *   3. registration.pushManager.subscribe({ applicationServerKey })
 *   4. POST /api/account/push/subscribe with the subscription
 *
 * Unsubscribe flow mirrors with subscription.unsubscribe() + DELETE.
 */
import { useCallback, useEffect, useState } from "react";

type Phase = "unsupported" | "default" | "granted-off" | "granted-on" | "denied" | "pending";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const std = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle() {
  const [phase, setPhase] = useState<Phase>("pending");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setPhase("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPhase("denied");
      return;
    }
    if (Notification.permission === "default") {
      setPhase("default");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setPhase(sub ? "granted-on" : "granted-off");
    } catch {
      setPhase("granted-off");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perm =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (perm !== "granted") {
        await refresh();
        return;
      }
      // Fetch VAPID public key from the server (it's also in the
      // NEXT_PUBLIC env, but this is more resilient).
      const meta = await fetch("/api/account/push/subscribe").then((r) => r.json());
      const key = meta?.vapid_public_key as string | undefined;
      if (!key) {
        setPhase("granted-off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyBytes = urlBase64ToUint8Array(key);
      // pushManager.subscribe's TS type narrows to a strict ArrayBuffer.
      // Hand it the underlying buffer to satisfy the strict TS lib types.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      });
      const json = sub.toJSON();
      await fetch("/api/account/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      setPhase("granted-on");
    } catch (err) {
      console.error("[push] enable failed", err);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const disable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch(
          `/api/account/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
          { method: "DELETE" },
        );
      }
      setPhase("granted-off");
    } catch (err) {
      console.error("[push] disable failed", err);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  if (phase === "pending" || phase === "unsupported") return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition";

  if (phase === "denied") {
    return (
      <span
        title="Browser blocked notifications. Re-enable in browser settings."
        className={`${base} cursor-default border-[var(--color-rule)] bg-[var(--color-cream)]/40 text-[var(--color-ink-soft)]`}
      >
        🔕 Blocked
      </span>
    );
  }
  if (phase === "granted-on") {
    return (
      <button
        type="button"
        onClick={disable}
        disabled={busy}
        title="Push notifications on for this device. Click to disable."
        className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 disabled:opacity-50`}
      >
        🔔 On
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy}
      title="Get Bri's nudges as push notifications on this device."
      className={`${base} border-[var(--color-rule)] bg-white text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50`}
    >
      🔔 {busy ? "…" : "Enable"}
    </button>
  );
}
