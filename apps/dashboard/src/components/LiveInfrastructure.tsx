'use client';

import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, Network, HardDrive } from 'lucide-react';

export type InfraMetric = {
  key: string;
  label: string;
  percent: number;
  detail: string;
  tone: 'accent' | 'success' | 'warning' | 'error';
};

const ICONS: Record<string, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  network: Network,
  storage: HardDrive
};

function toneColor(tone: InfraMetric['tone']): string {
  switch (tone) {
    case 'success':
      return '#22C55E';
    case 'warning':
      return '#F59E0B';
    case 'error':
      return '#EF4444';
    default:
      return '#4F7CFF';
  }
}

// Animated bar that grows from 0 to its target % on mount.
function Bar({ metric, delay }: { metric: InfraMetric; delay: number }) {
  const [width, setWidth] = useState(0);
  const Icon = ICONS[metric.key] ?? Cpu;
  const color = toneColor(metric.tone);

  useEffect(() => {
    const t = setTimeout(() => setWidth(metric.percent), 80 + delay);
    return () => clearTimeout(t);
  }, [metric.percent, delay]);

  return (
    <div className="infra-card">
      <div className="infra-head">
        <span className="infra-ico" style={{ color }}>
          <Icon size={18} />
        </span>
        <span className="infra-label">{metric.label}</span>
        <span className="infra-pct" style={{ color }}>
          {metric.percent}%
        </span>
      </div>
      <div className="infra-track">
        <div
          className="infra-fill"
          style={{
            width: `${width}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 14px ${color}66`
          }}
        />
      </div>
      <div className="infra-detail">{metric.detail}</div>
    </div>
  );
}

export function LiveInfrastructure({ metrics }: { metrics: InfraMetric[] }) {
  return (
    <div className="infra-grid">
      {metrics.map((m, i) => (
        <Bar key={m.key} metric={m} delay={i * 120} />
      ))}
    </div>
  );
}
