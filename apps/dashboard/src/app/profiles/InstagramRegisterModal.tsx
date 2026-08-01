'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X, AlertTriangle, Camera, Copy, Terminal, Image as ImageIcon, ShieldAlert } from 'lucide-react';
import { useFleetEvents } from '../../lib/live';

export type IgStep = { key: string; label: string; percent: number };

type IgProgress = {
  accountId: string;
  deviceId: string;
  jobId: string;
  step: string;
  label: string;
  percent: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  note?: string;
  shot?: string; // base64 JPEG (only over WS, never persisted)
};

type LogLine = { ts: string; step: string; percent: number; status: string; note?: string };

type Props = {
  accountId: string;
  deviceId: string;
  email: string;
  steps: IgStep[];
  onClose: () => void;
};

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function lineColor(l: LogLine): string {
  if (l.status === 'FAILED' || (l.note ?? '').startsWith('❌')) return '#f87171';
  if ((l.note ?? '').startsWith('✓')) return '#4ade80';
  if ((l.note ?? '').startsWith('⚠')) return '#fbbf24';
  if ((l.note ?? '').startsWith('📧') || (l.note ?? '').startsWith('📸')) return '#38bdf8';
  return '#94a3b8';
}

export default function InstagramRegisterModal({ accountId, deviceId, email, steps, onClose }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<IgProgress>({
    accountId,
    deviceId,
    jobId: '',
    step: 'queued',
    label: 'Kuyruğa alındı',
    percent: 3,
    status: 'RUNNING'
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [showShot, setShowShot] = useState(false);
  const [shotBig, setShotBig] = useState(false);
  const [accStatus, setAccStatus] = useState<string>('REGISTERING');
  const termRef = useRef<HTMLDivElement>(null);

  // Restore persisted history on open (covers "arka plana al" → reopen).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounts/instagram/register/${accountId}/status`);
        const body = await res.json().catch(() => ({}));
        const d = body?.data;
        if (cancelled || !d) return;
        if (Array.isArray(d.log) && d.log.length) setLogs(d.log as LogLine[]);
        if (d.lastProgress) setCurrent(d.lastProgress as IgProgress);
        if (typeof d.status === 'string') setAccStatus(d.status);
      } catch {
        /* no history yet — live events will fill it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Live progress: correlate by accountId.
  useFleetEvents(['instagram.register.progress'], (e) => {
    if (e.deviceId !== deviceId) return;
    const p = e.payload as IgProgress | undefined;
    if (!p || p.accountId !== accountId) return;
    setCurrent(p);
    if (p.shot) setShot(p.shot);
    if (p.note) {
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: p.note };
      // ★2026-08-01: ProvisionModal ile aynı çift-satır savunması (kök: live.tsx çift-soket).
      setLogs((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.note === line.note && last.step === line.step) return prev;
        return [...prev, line];
      });
    }
  });

  // A captcha/SMS wall is a terminal-but-not-success outcome — the account was
  // created but Instagram wants a human step. We surface it as its own state.
  const wall = current.step === 'wall' || accStatus === 'AWAITING_MANUAL';
  const done = !wall && (current.status === 'COMPLETED' || (current.percent >= 100 && accStatus === 'ACTIVE'));
  const failed = !wall && (current.status === 'FAILED' || accStatus === 'FAILED');

  useEffect(() => {
    if (done || failed || wall) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [done, failed, wall]);

  useEffect(() => {
    if (done || wall || failed) router.refresh();
  }, [done, wall, failed, router]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs.length]);

  const activeIdx = useMemo(
    () => Math.max(0, steps.findIndex((s) => s.key === current.step)),
    [steps, current.step]
  );

  const barColor = failed ? '#ef4444' : wall ? '#f59e0b' : done ? '#22c55e' : 'var(--accent, #6366f1)';

  function copyLogs() {
    const text = logs.map((l) => `${l.step}▸ ${l.note ?? l.step}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 'min(96vw, 640px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><Camera size={16} /> Instagram kaydı · {email}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>{wall ? 'Doğrulama duvarı (captcha/SMS)' : current.label}</span>
          <span style={{ opacity: 0.65 }}>%{current.percent} · {mmss(elapsed)}</span>
        </div>
        <span className="health-bar" style={{ display: 'block', marginBottom: 14 }}>
          <span className="health-bar-fill" style={{ width: `${current.percent}%`, background: barColor }} />
        </span>

        {/* Wall notice — the account exists but Instagram demanded a human step */}
        {wall && (
          <div style={{ border: '1px solid rgba(245,158,11,0.4)', borderLeft: '3px solid #f59e0b', background: 'rgba(245,158,11,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <ShieldAlert size={15} color="#f59e0b" /> <strong>Instagram doğrulama istedi</strong>
            </div>
            {current.note?.slice(0, 200) || 'Hesap oluşturuldu ama Instagram captcha veya telefon doğrulaması istedi. Canlı ekrandan elle tamamlayın.'}
          </div>
        )}

        {/* Live terminal */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.7 }}>
            <Terminal size={13} /> Canlı kayıt günlüğü
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={() => setShowShot((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <ImageIcon size={12} /> {showShot ? 'SS gizle' : 'SS göster'}
            </button>
            <button
              type="button"
              onClick={copyLogs}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.7, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <Copy size={12} /> {copied ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div
            ref={termRef}
            style={{
              flex: '1 1 220px',
              minWidth: 0,
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
              <span style={{ opacity: 0.5 }}>Kayıt başlatılıyor…</span>
            ) : (
              logs.map((l, i) => (
                <div key={i} style={{ color: lineColor(l) }}>
                  <span style={{ opacity: 0.45 }}>{l.step}▸ </span>
                  {l.note}
                </div>
              ))
            )}
            {!done && !failed && !wall && (
              <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Loader2 size={12} className="spin" /> çalışıyor…
              </div>
            )}
          </div>

          {/* Optional live screenshot (SS göster) */}
          {showShot && (
            <div style={{ flex: '1 1 120px', maxWidth: 180, marginBottom: 14 }}>
              {shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/jpeg;base64,${shot}`}
                  alt="cihaz ekranı"
                  onClick={() => setShotBig(true)}
                  style={{ width: '100%', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', cursor: 'zoom-in', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: 220, borderRadius: 8, border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: 0.5, textAlign: 'center', padding: 8 }}>
                  Ekran görüntüsü bekleniyor…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Enlarged screenshot overlay */}
        {shotBig && shot && (
          <div className="modal-overlay" onClick={() => setShotBig(false)} style={{ zIndex: 60 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`data:image/jpeg;base64,${shot}`} alt="cihaz ekranı" style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: 10, cursor: 'zoom-out' }} onClick={() => setShotBig(false)} />
          </div>
        )}

        {/* Step list (compact) — the terminal `wall` step is hidden from the plan.
            auto-fit drops it to a single column on narrow phones. */}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 16px' }}>
          {steps
            .filter((s) => s.key !== 'queued' && s.key !== 'wall')
            .map((s) => {
              const idx = steps.findIndex((x) => x.key === s.key);
              const isDone = done || idx < activeIdx || current.percent >= s.percent;
              const isActive = !done && !failed && !wall && idx === activeIdx;
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
                <Check size={18} /> Instagram hesabı hazır
              </span>
              <button type="button" className="btn-primary" onClick={onClose}>Kapat</button>
            </>
          ) : wall ? (
            <>
              <span style={{ color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldAlert size={18} /> Doğrulama gerekiyor (canlı ekrandan)
              </span>
              <button type="button" className="btn-ghost" onClick={onClose}>Kapat</button>
            </>
          ) : failed ? (
            <>
              <span style={{ color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={18} /> {current.note?.slice(0, 60) || 'Kayıt başarısız'}
              </span>
              <button type="button" className="btn-ghost" onClick={onClose}>Kapat</button>
            </>
          ) : (
            <button type="button" className="btn-ghost" onClick={onClose}>Arka planda devam et</button>
          )}
        </footer>
      </div>
    </div>
  );
}
