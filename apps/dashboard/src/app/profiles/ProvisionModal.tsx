'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X, AlertTriangle, Smartphone, Copy, Terminal } from 'lucide-react';
import { useFleetEvents } from '../../lib/live';

export type ProvisionStep = { key: string; label: string; percent: number };

type ProvisionProgress = {
  deviceId: string;
  jobId: string;
  step: string;
  label: string;
  percent: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  note?: string;
};

type LogLine = { ts: string; step: string; percent: number; status: string; note?: string };

type Props = {
  jobId: string;
  deviceId: string;
  instance: string;
  name?: string;
  steps: ProvisionStep[];
  onClose: () => void;
};

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// A log line's color by its content/status.
function lineColor(l: LogLine): string {
  if (l.status === 'FAILED' || (l.note ?? '').startsWith('❌')) return '#f87171';
  if ((l.note ?? '').startsWith('✓')) return '#4ade80';
  if ((l.note ?? '').startsWith('⚠')) return '#fbbf24';
  return '#94a3b8';
}

export default function ProvisionModal({ jobId, deviceId, instance, name, steps, onClose }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<ProvisionProgress>({
    deviceId,
    jobId,
    step: 'queued',
    label: 'Kuyruğa alındı',
    percent: 3,
    status: 'RUNNING'
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  // Real provisioning start (first log line's ts). Count elapsed from THIS, not from
  // modal-open — otherwise reopening a background provision reset the clock to 00:00.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  // Restore persisted history on open (covers "arka plana al" → reopen).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/provision/status/${jobId}`);
        const body = await res.json().catch(() => ({}));
        const d = body?.data;
        if (cancelled || !d) return;
        if (Array.isArray(d.log) && d.log.length) setLogs(d.log as LogLine[]);
        if (d.lastProgress) setCurrent(d.lastProgress as ProvisionProgress);
        // Anchor the elapsed clock to the real start (API startedAt, else first log ts)
        // so reopening a background provision shows true elapsed time, not 00:00.
        const firstTs = d.startedAt ?? (Array.isArray(d.log) && d.log[0]?.ts) ?? null;
        if (firstTs) {
          const ms = Date.parse(firstTs);
          if (!Number.isNaN(ms)) setStartedAt(ms);
        }
      } catch {
        /* no history yet — live events will fill it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Live progress: append every event's note to the terminal; update the header.
  useFleetEvents(['provision.progress'], (e) => {
    if (e.deviceId !== deviceId) return;
    const p = e.payload as ProvisionProgress | undefined;
    if (!p || p.jobId !== jobId) return;
    setCurrent(p);
    // First live event also anchors the clock (brand-new provision, no history yet).
    setStartedAt((prev) => prev ?? (e.timestamp ? Date.parse(e.timestamp) : Date.now()));
    if (p.note) {
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: p.note };
      setLogs((prev) => [...prev, line]);
    }
  });

  const done = current.status === 'COMPLETED' || current.percent >= 100;
  const failed = current.status === 'FAILED';

  // Elapsed timer — counts from the REAL start (startedAt) so it survives modal
  // close/reopen. Freezes once terminal (done/failed) at the true total duration.
  useEffect(() => {
    if (done || failed) return;
    const tick = () => {
      if (startedAt) setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      else setElapsed((v) => v + 1);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [done, failed, startedAt]);

  // Refresh the device list when provisioning succeeds.
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  // Auto-scroll terminal to the newest line.
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs.length]);

  const activeIdx = useMemo(
    () => Math.max(0, steps.findIndex((s) => s.key === current.step)),
    [steps, current.step]
  );

  const barColor = failed ? '#ef4444' : done ? '#22c55e' : 'var(--accent, #6366f1)';

  function copyLogs() {
    const text = logs.map((l) => `[${mmss(0)}] ${l.note ?? l.step}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Cancel a stuck/unwanted provision: flips the job FAILED server-side and marks the
  // half-built device FAILED so the card stops showing a frozen "kuruluyor". The live
  // job.updated broadcast refreshes the badge; we also flip local state so the modal
  // shows the failed footer immediately without waiting for the round-trip event.
  async function cancelProvision() {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelMsg(null);
    try {
      const res = await fetch(`/api/provision/cancel/${encodeURIComponent(jobId)}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCancelMsg(body?.error || 'Kurulum iptal edilemedi');
        return;
      }
      setCurrent((c) => ({ ...c, status: 'FAILED', note: 'Kurulum iptal edildi', label: 'İptal edildi' }));
      router.refresh();
    } catch {
      setCancelMsg('Kurulum iptal edilemedi (ağ hatası)');
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 'min(96vw, 640px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><Smartphone size={16} /> Cihaz kuruluyor · {name || instance}{name ? <span style={{ opacity: 0.5, fontWeight: 400 }}> ({instance})</span> : null}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>{current.label}</span>
          <span style={{ opacity: 0.65 }}>%{current.percent} · {mmss(elapsed)}</span>
        </div>
        <span className="health-bar" style={{ display: 'block', marginBottom: 14 }}>
          <span className="health-bar-fill" style={{ width: `${current.percent}%`, background: barColor }} />
        </span>

        {/* Live terminal */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.7 }}>
            <Terminal size={13} /> Canlı kurulum günlüğü
          </span>
          <button
            type="button"
            onClick={copyLogs}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>
        </div>
        <div
          ref={termRef}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.55,
            background: '#0b1020',
            color: '#94a3b8',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '10px 12px',
            height: 220,
            overflowY: 'auto',
            marginBottom: 14,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {logs.length === 0 ? (
            <span style={{ opacity: 0.5 }}>Kuruluma başlanıyor…</span>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ color: lineColor(l) }}>
                <span style={{ opacity: 0.45 }}>{l.step}▸ </span>
                {l.note}
              </div>
            ))
          )}
          {!done && !failed && (
            <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Loader2 size={12} className="spin" /> çalışıyor…
            </div>
          )}
        </div>

        {/* Step list (compact) — auto-fit so it drops to a single column on narrow phones. */}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 16px' }}>
          {steps
            .filter((s) => s.key !== 'queued')
            .map((s) => {
              const idx = steps.findIndex((x) => x.key === s.key);
              const isDone = done || idx < activeIdx || current.percent >= s.percent;
              const isActive = !done && !failed && idx === activeIdx;
              return (
                <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: isDone || isActive ? 1 : 0.4 }}>
                  <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>
                    {isDone ? (
                      <Check size={14} color="#22c55e" />
                    ) : isActive ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.4 }} />
                    )}
                  </span>
                  <span style={{ fontSize: 12 }}>{s.label}</span>
                </li>
              );
            })}
        </ol>

        <footer className="modal-foot">
          {done ? (
            <>
              <span style={{ color: '#22c55e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={18} /> WhatsApp-hazır
              </span>
              <button type="button" className="btn-primary" onClick={onClose}>Kapat</button>
            </>
          ) : failed ? (
            <>
              <span style={{ color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={18} /> Kurulum başarısız
              </span>
              <button type="button" className="btn-ghost" onClick={onClose}>Kapat</button>
            </>
          ) : (
            <>
              {cancelMsg ? <span className="field-error" style={{ marginRight: 'auto', fontSize: 12 }}>{cancelMsg}</span> : null}
              <button type="button" className="btn-ghost" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }} disabled={cancelBusy} onClick={cancelProvision}>
                {cancelBusy ? 'İptal ediliyor…' : 'Kurulumu İptal Et'}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>Arka planda devam et</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
