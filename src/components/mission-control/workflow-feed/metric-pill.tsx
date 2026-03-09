'use client';

interface MetricPillProps {
  label: string;
  value: string;
  color?: string;
}

export function MetricPill({ label, value, color }: MetricPillProps) {
  return (
    <span
      className="mc-metric-pill"
      style={color ? { color, background: `color-mix(in srgb, ${color} 10%, var(--mc-overlay, #f3f3f0))` } : undefined}
    >
      <span className="opacity-70">{label}</span>
      <span className="mc-metric-pill-value">{value}</span>
    </span>
  );
}
