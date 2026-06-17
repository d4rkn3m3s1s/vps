'use client';

import { Globe } from 'lucide-react';

export type RegionStat = {
  region: string;
  count: number;
  online: number;
  share: number; // 0-100 of total fleet
};

// Approximate dot positions per region on a simple equirectangular layout (% of box).
const REGION_POS: Record<string, { x: number; y: number }> = {
  'North America': { x: 22, y: 38 },
  'South America': { x: 33, y: 70 },
  Europe: { x: 50, y: 33 },
  'Middle East': { x: 60, y: 47 },
  Asia: { x: 74, y: 42 }
};

export function DeviceMap({ regions, total }: { regions: RegionStat[]; total: number }) {
  return (
    <div className="map-wrap">
      <div className="map-canvas">
        {/* Stylized grid "globe" backdrop */}
        <div className="map-grid" aria-hidden />
        {regions.map((r) => {
          const pos = REGION_POS[r.region] ?? { x: 50, y: 50 };
          const size = 14 + Math.min(r.share, 60) * 0.5;
          return (
            <div
              key={r.region}
              className="map-pin"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              title={`${r.region}: ${r.count} devices`}
            >
              <span className="map-pin-pulse" style={{ width: size, height: size }} />
              <span className="map-pin-dot" style={{ width: size * 0.45, height: size * 0.45 }} />
              <span className="map-pin-label">{r.count}</span>
            </div>
          );
        })}
        <div className="map-legend">
          <Globe size={14} />
          <span>{total} devices live across {regions.filter((r) => r.count > 0).length} regions</span>
        </div>
      </div>

      <div className="map-list">
        {regions.map((r) => (
          <div key={r.region} className="map-row">
            <div className="map-row-head">
              <span className="map-row-name">{r.region}</span>
              <span className="map-row-count">{r.count}</span>
            </div>
            <div className="map-row-track">
              <div className="map-row-fill" style={{ width: `${Math.max(r.share, r.count > 0 ? 6 : 0)}%` }} />
            </div>
            <div className="map-row-sub">
              {r.online} online · {r.share}% of fleet
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
