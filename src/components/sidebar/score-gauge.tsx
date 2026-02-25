'use client';

interface ScoreGaugeProps {
  value: number;
  max: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  invert?: boolean; // true = lower is better (AI detection)
}

export function ScoreGauge({
  value,
  max,
  label,
  size = 'md',
  invert = false,
}: ScoreGaugeProps) {
  const ratio = invert ? (max - value) / max : value / max;
  const color =
    ratio > 0.66
      ? 'text-green-500'
      : ratio > 0.33
        ? 'text-yellow-500'
        : 'text-red-500';
  const strokeColor =
    ratio > 0.66
      ? 'stroke-green-500'
      : ratio > 0.33
        ? 'stroke-yellow-500'
        : 'stroke-red-500';

  const dimensions = {
    sm: { size: 64, stroke: 4, text: 'text-lg', label: 'text-[10px]' },
    md: { size: 96, stroke: 6, text: 'text-2xl', label: 'text-xs' },
    lg: { size: 128, stroke: 8, text: 'text-3xl', label: 'text-sm' },
  }[size];

  const radius = (dimensions.size - dimensions.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, value / max)));

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: dimensions.size, height: dimensions.size }}>
        <svg
          width={dimensions.size}
          height={dimensions.size}
          className="-rotate-90"
        >
          <circle
            cx={dimensions.size / 2}
            cy={dimensions.size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={dimensions.stroke}
            className="text-muted/30"
          />
          <circle
            cx={dimensions.size / 2}
            cy={dimensions.size / 2}
            r={radius}
            fill="none"
            strokeWidth={dimensions.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={`${strokeColor} transition-all duration-500`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${dimensions.text} ${color} tabular-nums`}>
            {typeof value === 'number' ? (max <= 5 ? value.toFixed(1) : Math.round(value)) : '--'}
          </span>
        </div>
      </div>
      <p className={`${dimensions.label} text-muted-foreground mt-1`}>{label}</p>
    </div>
  );
}
