"use client";

/**
 * On dashboard mount, read the browser's IANA timezone and POST it to the
 * server. The server diffs against the stored value and skips the bump if
 * unchanged — so this fires on every page load with no cost when settled.
 * Renders a tiny footer line so the parent can see what was pushed.
 */
import { useEffect, useState } from "react";

type TZ = {
  iana: string | null;
  posix: string | null;
  unchanged?: boolean;
  error?: string;
};

export function TimezoneSync() {
  const [state, setState] = useState<TZ>({ iana: null, posix: null });

  useEffect(() => {
    const browserIana = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserIana) {
      void fetch("/api/account/timezone")
        .then((r) => r.json())
        .then((d) => setState({ iana: d.iana, posix: d.posix }));
      return;
    }
    void fetch("/api/account/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iana: browserIana }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setState({ iana: d.iana, posix: d.posix, unchanged: d.unchanged });
        } else {
          // Browser TZ wasn't in our IANA→POSIX table — fetch what's stored
          // so we still show *something*, and log the gap for follow-up.
          // eslint-disable-next-line no-console
          console.warn("timezone sync:", d.error);
          void fetch("/api/account/timezone")
            .then((r) => r.json())
            .then((d2) =>
              setState({
                iana: d2.iana,
                posix: d2.posix,
                error: `browser TZ "${browserIana}" not yet mapped`,
              }),
            );
        }
      })
      .catch(() => {
        /* network hiccup — silently skip */
      });
  }, []);

  if (!state.iana && !state.error) return null;

  return (
    <p className="mt-4 text-center text-xs text-[var(--color-ink-soft)]">
      Router timezone: <strong>{state.iana ?? "UTC (fallback)"}</strong>
      {state.error ? (
        <>
          {" "}
          —{" "}
          <span className="text-orange-700">
            {state.error}; tell us in chat and we&rsquo;ll add it
          </span>
        </>
      ) : null}
    </p>
  );
}
