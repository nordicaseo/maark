'use client';

type PillVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusPillProps {
  text: string;
  variant: PillVariant;
}

const VARIANT_STYLES: Record<PillVariant, { color: string; bg: string }> = {
  success: { color: '#266847', bg: 'rgba(58,149,103,0.11)' },
  warning: { color: '#895e23', bg: 'rgba(209,151,69,0.12)' },
  error:   { color: '#8a2d20', bg: 'rgba(197,83,66,0.12)' },
  info:    { color: '#1d4a7a', bg: 'rgba(74,158,218,0.12)' },
  neutral: { color: '#6b6259', bg: 'rgba(144,129,111,0.10)' },
};

export function StatusPill({ text, variant }: StatusPillProps) {
  const styles = VARIANT_STYLES[variant];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none whitespace-nowrap"
      style={{ color: styles.color, background: styles.bg }}
    >
      {text}
    </span>
  );
}
