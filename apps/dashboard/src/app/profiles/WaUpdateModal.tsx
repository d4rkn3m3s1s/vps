'use client';

// ★2026-08-15 WhatsApp toplu-güncelleme ilerleme modalı. Seçili cihazların WA'sını
// filo-referans APK'ya güncelleyen WA_UPDATE_APK job'larını CANLI izler: her cihaz
// için yüzde + son not + durum. provision.progress WS event'ini dinler (agent
// waUpdateApk her aşamada percent+note gönderir); event'in jobId'si bizim listedeyse
// ilgili cihazın satırını günceller. ProvisionModal'ın çoklu-cihaz kardeşi.

import { useMemo, useRef, useState, useEffect } from 'react';
import { Check, Loader2, X, AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { useFleetEvents } from '../../lib/live';

export type WaJobRef = { deviceId: string; id: string; name?: string; instance?: string };
type Row = { percent: number; note: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED' };

type Props = { jobs: WaJobRef[]; skipped?: { deviceId: string; reason: string }[]; onClose: () => void };

function rowColor(r: Row): string {
  if (r.status === 'FAILED') return '#f87171';
  if (r.status === 'COMPLETED' || r.percent >= 100) return '#4ade80';
  return 'var(--accent, #6366f1)';
}

export default function WaUpdateModal({ jobs, skipped, onClose }: Props) {
  const jobIds = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(jobs.map((j) => [j.deviceId, { percent: 2, note: 'Kuyruğa alındı', status: 'RUNNING' as const }]))
  );
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Canlı ilerleme: event'in jobId'si bizim job'larımızdan biriyse o cihazın satırını güncelle.
  useFleetEvents(['provision.progress'], (e) => {
    const p = e.payload as { jobId?: string; percent?: number; note?: string; status?: string } | undefined;
    if (!p || !p.jobId || !jobIds.has(p.jobId)) return;
    const did = e.deviceId;
    if (!did) return;
    setRows((prev) => ({
      ...prev,
      [did]: {
        percent: typeof p.percent === 'number' ? p.percent : prev[did]?.percent ?? 0,
        note: p.note ?? prev[did]?.note ?? '',
        status: (p.status as Row['status']) ?? prev[did]?.status ?? 'RUNNING'
      }
    }));
  });

  const list = jobs.map((j) => ({ ...j, row: rows[j.deviceId] ?? { percent: 0, note: '', status: 'RUNNING' as const } }));
  const total = jobs.length;
  const doneCount = list.filter((x) => x.row.status === 'COMPLETED' || x.row.percent >= 100).length;
  const failCount = list.filter((x) => x.row.status === 'FAILED').length;
  const allDone = total > 0 && doneCount + failCount >= total;
  const avg = total ? Math.round(list.reduce((s, x) => s + Math.min(100, x.row.percent), 0) / total) : 0;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [allDone]);

  function copyLogs() {
    const text = list.map((x) => `${x.name || x.instance || x.deviceId}: %${x.row.percent} ${x.row.status} — ${x.row.note}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const barColor = failCount > 0 && allDone ? '#f59e0b' : allDone ? '#22c55e' : 'var(--accent, #6366f1)';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sticky" style={{ maxWidth: 'min(96vw, 680px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><RefreshCw size={16} /> WhatsApp Güncelleme · {total} cihaz</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="modal-scroll">
          {/* Genel özet + ortalama bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{doneCount}</span> tamam
              {failCount > 0 ? <> · <span style={{ color: '#f87171', fontWeight: 600 }}>{failCount}</span> başarısız</> : null}
              {' '}/ {total}
            </span>
            <span style={{ opacity: 0.65 }}>ortalama %{avg}</span>
          </div>
          <span className="health-bar" style={{ display: 'block', marginBottom: 8 }}>
            <span className="health-bar-fill" style={{ width: `${avg}%`, background: barColor }} />
          </span>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Hesap/mesaj korunarak güncellenir (pm install -r)</span>
            <button type="button" onClick={copyLogs}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
              <Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>

          {/* Cihaz satırları */}
          <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto' }}>
            {list.map((x) => {
              const done = x.row.status === 'COMPLETED' || x.row.percent >= 100;
              const failed = x.row.status === 'FAILED';
              return (
                <div key={x.deviceId} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, minWidth: 0 }}>
                      <span style={{ width: 15, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}>
                        {failed ? <AlertTriangle size={14} color="#f87171" />
                          : done ? <Check size={14} color="#22c55e" />
                          : <Loader2 size={13} className="spin" />}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {x.name || x.instance || x.deviceId}
                      </span>
                    </span>
                    <span style={{ opacity: 0.6, fontSize: 12, flexShrink: 0 }}>%{Math.min(100, x.row.percent)}</span>
                  </div>
                  <span className="health-bar" style={{ display: 'block', marginBottom: 5, height: 4 }}>
                    <span className="health-bar-fill" style={{ width: `${Math.min(100, x.row.percent)}%`, background: rowColor(x.row) }} />
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.7, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {x.row.note || '…'}
                  </span>
                </div>
              );
            })}

            {(skipped ?? []).map((s) => (
              <div key={s.deviceId} style={{ border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: '8px 10px', opacity: 0.75 }}>
                <span style={{ fontSize: 12, color: '#f87171' }}>
                  <AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {s.deviceId} — atlandı: {s.reason}
                </span>
              </div>
            ))}
          </div>
        </div>

        <footer className="modal-foot">
          {allDone ? (
            <>
              <span style={{ color: failCount > 0 ? '#f59e0b' : '#22c55e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={18} /> {failCount > 0 ? `${doneCount} güncellendi, ${failCount} başarısız` : 'Tümü güncellendi'}
              </span>
              <button type="button" className="btn-primary" onClick={onClose}>Kapat</button>
            </>
          ) : (
            <>
              <span style={{ marginRight: 'auto', fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="spin" /> güncelleniyor…
              </span>
              <button type="button" className="btn-ghost" onClick={onClose}>Arka planda devam et</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
