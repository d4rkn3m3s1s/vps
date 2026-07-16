'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X, AlertTriangle, MessageCircle, Copy, Terminal, Image as ImageIcon } from 'lucide-react';
import { useFleetEvents } from '../../lib/live';

export type WaStep = { key: string; label: string; percent: number };

type WaProgress = {
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
  phoneNumber: string;
  steps: WaStep[];
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
  if ((l.note ?? '').startsWith('📲') || (l.note ?? '').startsWith('📸')) return '#38bdf8';
  return '#94a3b8';
}

export default function WhatsappRegisterModal({ accountId, deviceId, phoneNumber, steps, onClose }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState<WaProgress>({
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
  const [shot, setShot] = useState<string | null>(null); // latest downscaled screenshot
  const [showShot, setShowShot] = useState(false); // "SS göster" toggle (off by default)
  const [shotBig, setShotBig] = useState(false); // click-to-enlarge
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  // Restore persisted history on open (covers "arka plana al" → reopen).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/status`);
        const body = await res.json().catch(() => ({}));
        const d = body?.data;
        if (cancelled || !d) return;
        if (Array.isArray(d.log) && d.log.length) setLogs(d.log as LogLine[]);
        if (d.lastProgress) setCurrent(d.lastProgress as WaProgress);
      } catch {
        /* no history yet — live events will fill it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Live progress: correlate by accountId (the flow spans two jobs).
  useFleetEvents(['whatsapp.register.progress'], (e) => {
    if (e.deviceId !== deviceId) return;
    const p = e.payload as WaProgress | undefined;
    if (!p || p.accountId !== accountId) return;
    setCurrent(p);
    if (p.shot) setShot(p.shot);
    if (p.note) {
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: p.note };
      setLogs((prev) => [...prev, line]);
    }
  });

  const done = current.status === 'COMPLETED' || current.percent >= 100;
  const failed = current.status === 'FAILED';
  // OTP box appears when the flow parks at the code step. The agent parks here for
  // every "operator enters the code" case (plain SMS, code-on-other-phone, or a
  // rate-limit wait) and always reports step 'otp_wait'; keep the legacy alias too.
  const awaitingOtp = !done && !failed && (current.step === 'otp_wait' || current.step === 'otp_wait_manual');
  // Distinguish the 4 code-wait scenarios from the agent's note so the box shows the
  // right instruction instead of a generic "SMS". The note is the single source of
  // truth (agent emits a 📲 note; API mirrors it into the account).
  const otpNote = current.note ?? '';
  const otpIsOtherPhone = /diğer telefon|other phone|başka bir cihaz/i.test(otpNote);
  // Rate-limit'e ÖZGÜ kalıplar. NOT: geniş "bekle" KULLANMA — normal SMS note'u
  // ("SMS kodu bekleniyor") "bekleniyor" içerir ve yanlışlıkla rate-limit sanılırdı.
  const otpIsRateLimit = /\d+\s*(saat|hours?|dakika|minutes?)|Send SMS in|kısıtl|too many|geçici (olarak )?bekle|N saat/i.test(otpNote);
  const otpHint = otpIsOtherPhone
    ? { icon: '📲', title: 'Kod DİĞER TELEFONDA', body: `${phoneNumber} numarası zaten bir WhatsApp hesabına kayıtlı. 6 haneli kod SMS'e DEĞİL, o numaranın kayıtlı olduğu telefondaki WhatsApp'a gönderildi. Kodu o cihazdan okuyup buraya girin.` }
    : otpIsRateLimit
      ? { icon: '⏳', title: 'Geçici bekleme (rate-limit)', body: otpNote || `${phoneNumber} için WhatsApp geçici bekleme koydu. Süre dolunca kod gelir; geldiğinde buraya girin.` }
      : { icon: '📲', title: 'SMS doğrulama kodu bekleniyor', body: `${phoneNumber} numarasına SMS ile 6 haneli kod gelecek. Kod gelince buraya girin, ajan otomatik girer.` };

  useEffect(() => {
    if (done || failed) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [done, failed]);

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs.length]);

  const activeIdx = useMemo(
    () => Math.max(0, steps.findIndex((s) => s.key === current.step)),
    [steps, current.step]
  );

  const barColor = failed ? '#ef4444' : done ? '#22c55e' : awaitingOtp ? '#38bdf8' : 'var(--accent, #6366f1)';

  function copyLogs() {
    const text = logs.map((l) => `${l.step}▸ ${l.note ?? l.step}`).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function submitOtp() {
    const code = otp.replace(/\D/g, '');
    if (otpBusy || code.length < 4) { setOtpMsg('6 haneli kodu girin'); return; }
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/otp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otpCode: code })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpMsg(body?.data?.message || body?.error || 'Kod gönderilemedi'); return; }
      setOtpMsg('Kod gönderildi — ajan giriyor…');
      setOtp('');
      // The OTP job re-dispatches; progress keeps flowing on the same accountId.
      setCurrent((c) => ({ ...c, step: 'otp', label: 'SMS kodu giriliyor', percent: 90, status: 'RUNNING' }));
    } catch {
      setOtpMsg('Kod gönderilemedi (ağ hatası)');
    } finally {
      setOtpBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><MessageCircle size={16} /> WhatsApp kaydı · {phoneNumber}</h2>
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

        {/* OTP box — appears when the flow parks at the code step. The instruction
            adapts to the scenario (plain SMS / code-on-other-phone / rate-limit). */}
        {awaitingOtp && (
          <div style={{ border: `1px solid ${otpIsRateLimit ? 'rgba(251,191,36,0.45)' : 'rgba(56,189,248,0.4)'}`, borderLeft: `3px solid ${otpIsRateLimit ? '#fbbf24' : '#38bdf8'}`, background: otpIsRateLimit ? 'rgba(251,191,36,0.08)' : 'rgba(56,189,248,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {otpHint.icon} <strong>{otpHint.title}</strong>
              <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.4 }}>{otpHint.body}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field-input"
                inputMode="numeric"
                maxLength={8}
                placeholder="6 haneli kod"
                value={otp}
                autoFocus
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitOtp(); }}
                style={{ flex: 1, letterSpacing: 4, textAlign: 'center', fontSize: 16 }}
              />
              <button type="button" className="btn-primary" disabled={otpBusy || otp.replace(/\D/g, '').length < 4} onClick={submitOtp}>
                {otpBusy ? '…' : 'Gir'}
              </button>
            </div>
            {otpMsg ? <div style={{ fontSize: 12, marginTop: 6, color: otpMsg.startsWith('Kod gönderildi') ? '#4ade80' : '#f87171' }}>{otpMsg}</div> : null}
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

        <div style={{ display: 'flex', gap: 12 }}>
          <div
            ref={termRef}
            style={{
              flex: 1,
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
            {!done && !failed && !awaitingOtp && (
              <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Loader2 size={12} className="spin" /> çalışıyor…
              </div>
            )}
          </div>

          {/* Optional live screenshot (SS göster) */}
          {showShot && (
            <div style={{ width: 140, flex: '0 0 auto', marginBottom: 14 }}>
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

        {/* Step list (compact) */}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
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
                <Check size={18} /> WhatsApp hesabı hazır
              </span>
              <button type="button" className="btn-primary" onClick={onClose}>Kapat</button>
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
