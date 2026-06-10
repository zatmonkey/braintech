"use client";

/**
 * BrainrotMeter — the brand-y circle around the Braintech logo that goes
 * green → amber → red based on minutes of "brainrot" consumption in the
 * last 24h. Per the spec: < 10 min/day is green; 10–60 amber; > 60 red.
 *
 * Until /api/account/usage starts returning real category data, score is
 * null and we render a muted "—" state. The visual is the contract;
 * activating it when data exists is a wire-up, not a redesign.
 */

const GOOD = "#10b981"; // emerald-500
const WARN = "#f59e0b"; // amber-500
const BAD = "#dc2626"; // red-600
const MUTED = "var(--color-rule)";

function colorFor(minutes: number | null): string {
  if (minutes === null) return MUTED;
  if (minutes < 10) return GOOD;
  if (minutes < 60) return WARN;
  return BAD;
}

function label(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes === 0) return "0m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function BrainrotMeter({
  minutes,
  size = "sm",
  withLabel = true,
}: {
  /** Minutes of brainrot consumption in the last 24h. null = no data. */
  minutes: number | null;
  size?: "sm" | "lg";
  withLabel?: boolean;
}) {
  const dim = size === "lg" ? 88 : 36;
  const stroke = size === "lg" ? 6 : 3;
  const r = (dim - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Cap arc at 90 min for visual purposes — beyond that it's just maxed.
  const filled = minutes === null ? 0 : Math.min(1, minutes / 90);
  const dash = `${c * filled} ${c * (1 - filled)}`;
  const color = colorFor(minutes);

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg
          viewBox={`0 0 ${dim} ${dim}`}
          width={dim}
          height={dim}
          className="-rotate-90"
        >
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={r}
            fill="none"
            stroke={MUTED}
            strokeWidth={stroke}
            opacity={0.6}
          />
          {minutes !== null && (
            <circle
              cx={dim / 2}
              cy={dim / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={dash}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <BrainIcon size={size === "lg" ? 36 : 16} color={color} />
        </div>
      </div>
      {withLabel && (
        <div className="text-center leading-tight">
          <div
            className="font-mono text-[11px] font-medium"
            style={{ color: minutes === null ? "var(--color-ink-soft)" : color }}
          >
            {label(minutes)}
          </div>
          {size === "lg" && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-soft)]">
              brainrot · last 24h
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BrainIcon({ size, color }: { size: number; color: string }) {
  // The Braintech brain mark, stroked. Color follows the meter so the
  // mark itself reads green/amber/red at a glance.
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v2a3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 19a3 3 0 0 0 3 3" />
      <path d="M15 2a3 3 0 0 1 3 3v1a3 3 0 0 1 3 3v2a3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 19a3 3 0 0 1-3 3" />
      <path d="M12 4v18" />
    </svg>
  );
}
