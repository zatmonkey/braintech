"use client";

/**
 * Fires the variation view beacon exactly once per browser session.
 *
 * sessionStorage scopes the dedupe to the current tab/session — reloads
 * inside the same tab don't re-count, but a return visit tomorrow does.
 * That gives "views" a sensible meaning (unique session viewing variation N)
 * for conversion-rate math.
 *
 * Runs in useEffect so it never blocks render and never runs during SSR.
 */

import { useEffect } from "react";
import { sendGAEvent } from "@next/third-parties/google";

const VIEWED_KEY = "bt_var_viewed";
const VISITOR_KEY = "bt_visitor_id";

function visitorId(): string {
  let id = sessionStorage.getItem(VISITOR_KEY);
  if (id) return id;
  id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(VISITOR_KEY, id);
  return id;
}

export function VariationTracker({ variationId }: { variationId: string }) {
  useEffect(() => {
    try {
      const key = `${VIEWED_KEY}:${variationId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      const id = visitorId();

      // 1) DB beacon: increments the per-variation unique-view counter.
      fetch("/api/variation/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variation: variationId, visitorId: id }),
        keepalive: true,
      }).catch(() => {});

      // 2) Event-scoped GA tag so the variation shows up in standard reports
      //    without needing the user-property custom dimension wired in GA
      //    Admin. The user_property is set in layout.tsx for the auto
      //    page_view; this is the explicit, easy-to-find event.
      sendGAEvent("event", "variation_view", { variation: variationId });
    } catch {
      // sessionStorage can throw in some embedded/private-mode contexts.
      // We'd rather over-count than fail render.
    }
  }, [variationId]);
  return null;
}
