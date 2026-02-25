'use client';

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { SignalResult } from '@/types/analysis';

interface SignalRadarChartProps {
  signals: SignalResult[];
  size?: 'small' | 'large';
}

const SHORT_NAMES: Record<number, string> = {
  1: 'Lexical Div.',
  2: 'Burstiness',
  3: 'Semantic Drift',
  4: 'Repetition',
  5: 'Pronominal',
  6: 'Passive Voice',
  7: 'Idioms',
  8: 'Transitions',
  9: 'Complexity',
  10: 'Emotional',
  11: 'Cliches',
  12: 'Rhetorical Q',
  13: 'Verb Tense',
  14: 'Adverb Fluff',
  15: 'Proper Nouns',
  16: 'Formatting',
  17: 'Metaphors',
  18: 'Nuance',
  19: 'Prompt Leak',
  20: 'Perplexity',
  21: 'Colon Lead-In',
};

function getScoreColor(score: number): string {
  if (score <= 2) return '#22c55e';
  if (score === 3) return '#eab308';
  return '#ef4444';
}

interface CustomTickProps {
  x?: number;
  y?: number;
  payload?: { value: string; index: number };
  signals?: SignalResult[];
  fontSize?: number;
}

function CustomTick({ x = 0, y = 0, payload, signals = [], fontSize = 9 }: CustomTickProps) {
  if (!payload) return null;
  const signal = signals[payload.index];
  const color = signal ? getScoreColor(signal.score) : '#888';

  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fill={color}
      fontSize={fontSize}
      fontWeight={500}
    >
      {payload.value}
    </text>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold text-white">{data.fullName}</p>
      <div className="flex items-center gap-2 mt-1">
        <span
          className="text-sm font-bold"
          style={{ color: getScoreColor(data.score) }}
        >
          {data.score}/5
        </span>
        <span className="text-[10px] text-zinc-400">Weight: {data.weight}x</span>
      </div>
    </div>
  );
}

export function SignalRadarChart({ signals, size = 'small' }: SignalRadarChartProps) {
  const data = signals.map((s) => ({
    name: SHORT_NAMES[s.signalId] || s.name,
    fullName: `#${s.signalId} ${s.name}`,
    score: s.score,
    weight: s.weight,
  }));

  const isLarge = size === 'large';
  const height = isLarge ? '100%' : 280;
  const outerRadius = isLarge ? '68%' : '72%';
  const labelFontSize = isLarge ? 11 : 9;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius={outerRadius}>
          <PolarGrid
            stroke="#333"
            strokeDasharray="2 4"
          />
          <PolarAngleAxis
            dataKey="name"
            tick={<CustomTick signals={signals} fontSize={labelFontSize} />}
            tickLine={false}
          />
          <PolarRadiusAxis
            domain={[0, 5]}
            tickCount={6}
            tick={{ fontSize: isLarge ? 10 : 8, fill: '#555' }}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Radar
            dataKey="score"
            stroke="#8b5cf6"
            strokeWidth={2}
            fill="#8b5cf6"
            fillOpacity={0.15}
            dot={{
              r: isLarge ? 4 : 3,
              fill: '#8b5cf6',
              stroke: '#0a0a0a',
              strokeWidth: 1.5,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
