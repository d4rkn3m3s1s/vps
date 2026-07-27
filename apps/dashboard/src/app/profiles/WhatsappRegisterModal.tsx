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
  proxyCountry?: string | null;
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

// Map an E.164 number's calling code to an ISO-2 country (mirrors the API's
// CC_TO_ISO) so the modal can show whether the proxy exit matches the number.
const CC_TO_ISO: Record<string, string> = {
  '355': 'AL', '90': 'TR', '49': 'DE', '44': 'GB', '33': 'FR', '39': 'IT', '34': 'ES',
  '31': 'NL', '351': 'PT', '30': 'GR', '359': 'BG', '40': 'RO', '48': 'PL', '380': 'UA',
  '7': 'RU', '46': 'SE', '47': 'NO', '45': 'DK', '358': 'FI', '43': 'AT', '41': 'CH',
  '32': 'BE', '353': 'IE', '1': 'US', '55': 'BR', '52': 'MX', '54': 'AR', '91': 'IN',
  '971': 'AE', '966': 'SA', '20': 'EG', '27': 'ZA', '234': 'NG', '61': 'AU', '81': 'JP'
};
function numberCountry(phone: string): string | null {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  for (const len of [3, 2, 1]) { const cc = d.slice(0, len); if (CC_TO_ISO[cc]) return CC_TO_ISO[cc]; }
  return null;
}

export default function WhatsappRegisterModal({ accountId, deviceId, phoneNumber, steps, proxyCountry, onClose }: Props) {
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
  // The real registration start (first log line's ts). We count elapsed from THIS,
  // not from modal-open — otherwise reopening a background run reset the clock to 00:00.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [shot, setShot] = useState<string | null>(null); // latest downscaled screenshot
  const [showShot, setShowShot] = useState(false); // "SS göster" toggle (off by default)
  const [shotBig, setShotBig] = useState(false); // click-to-enlarge
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
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
        // Anchor the elapsed clock to the real start (API's startedAt, else the first
        // log line's ts). Falls back to modal-open only if there's no history at all.
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
  }, [accountId]);

  // Live progress: correlate by accountId (the flow spans two jobs).
  useFleetEvents(['whatsapp.register.progress'], (e) => {
    if (e.deviceId !== deviceId) return;
    const p = e.payload as WaProgress | undefined;
    if (!p || p.accountId !== accountId) return;
    const pn = p.note ?? '';
    // A heartbeat frame ('🎥 canlı') is a ~5s live-thumbnail tick, NOT a state change.
    // Update ONLY the live screenshot — never let it overwrite `current`.
    if (pn === '🎥 canlı') {
      if (p.shot) setShot(p.shot);
      return;
    }
    // ★FIX: a '📸 <label>' frame is a screenshot snapshot (snap()), NOT a state change
    // either. It was OVERWRITING `current` — so a '📸 choose_verify' frame arriving right
    // after the "🔀 Doğrulama yöntemi seçin" prompt clobbered the note → isMethodSelect
    // flipped false → the method-select BUTTONS vanished and the operator couldn't pick
    // (exact bug reported live). Treat it like a heartbeat: refresh the screenshot + log
    // it, but do NOT replace `current`/its parked-state note.
    if (pn.startsWith('📸')) {
      if (p.shot) setShot(p.shot);
      const line: LogLine = { ts: e.timestamp ?? new Date().toISOString(), step: p.step, percent: p.percent, status: p.status, note: pn };
      setLogs((prev) => [...prev, line]);
      return;
    }
    setCurrent(p);
    if (p.shot) setShot(p.shot);
    // First live event we ever see also anchors the clock (covers a brand-new run
    // with no persisted history yet). Only set it once — never let a later event push
    // the start forward.
    setStartedAt((prev) => prev ?? (e.timestamp ? Date.parse(e.timestamp) : Date.now()));
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
  const otpNote = current.note ?? '';
  // "Choose how to verify" — the agent paused on WhatsApp's method sheet and wants the
  // operator to pick SMS / Voice / Missed call (instead of the old blind guess). The
  // agent emits a "🔀 Doğrulama yöntemi seçin: …" note listing each option and whether
  // it's rate-limited ("(kısıtlı — 24 hours)"). We detect that note and, instead of the
  // OTP code box, show tappable method buttons.
  const isMethodSelect = !done && !failed && current.step === 'otp_wait' && /Doğrulama yöntemi seçin/i.test(otpNote);
  // Parse the option list out of the note so we can disable rate-limited ones. The agent
  // emits the note listing WHICHEVER options WhatsApp's sheet showed, in Turkish labels:
  // "🔀 Doğrulama yöntemi seçin: Diğer cihaz · Missed call · Receive SMS · Voice call".
  // ★FIX: (1) add 'other_device' (was missing → when the sheet only offered "Diğer cihaz"
  // + others, that option never rendered and the modal could look empty); (2) match BOTH
  // the Turkish label the agent prints AND the English WhatsApp row name, so a note in
  // either form is parsed. Each option becomes a tappable button.
  const methodOptions = useMemo(() => {
    type Kind = 'sms' | 'voice' | 'missed_call' | 'other_device';
    if (!isMethodSelect) return [] as { kind: Kind; label: string; locked: boolean; wait: string | null }[];
    const defs: { kind: Kind; label: string; re: RegExp }[] = [
      { kind: 'sms', label: 'SMS ile kod', re: /Receive SMS|SMS ile kod/i },
      { kind: 'voice', label: 'Sesli arama', re: /Voice call|Sesli arama/i },
      { kind: 'missed_call', label: 'Cevapsız çağrı', re: /Missed call|Cevapsız çağrı/i },
      { kind: 'other_device', label: 'Diğer cihaz', re: /Other device|Diğer cihaz/i }
    ];
    return defs
      .filter((d) => d.re.test(otpNote))
      .map((d) => {
        const seg = (otpNote.split(d.re)[1] || '').slice(0, 40);
        const lockM = /kısıtlı(?:\s*—\s*([^)·]+))?/i.exec(seg);
        return { kind: d.kind, label: d.label, locked: Boolean(lockM), wait: lockM?.[1]?.trim() ?? null };
      });
  }, [isMethodSelect, otpNote]);

  const awaitingOtp = !done && !failed && !isMethodSelect && (current.step === 'otp_wait' || current.step === 'otp_wait_manual');
  // Distinguish the 4 code-wait scenarios from the agent's note so the box shows the
  // right instruction instead of a generic "SMS". The note is the single source of
  // truth (agent emits a 📲 note; API mirrors it into the account).
  const otpIsOtherPhone = /diğer telefon|other phone|başka bir cihaz/i.test(otpNote);
  // Rate-limit'e ÖZGÜ kalıplar. NOT: geniş "bekle" KULLANMA — normal SMS note'u
  // ("SMS kodu bekleniyor") "bekleniyor" içerir ve yanlışlıkla rate-limit sanılırdı.
  const otpIsRateLimit = /\d+\s*(saat|hours?|dakika|minutes?)|Send SMS in|kısıtl|too many|geçici (olarak )?bekle|N saat/i.test(otpNote);
  const otpHint = otpIsOtherPhone
    ? { icon: '📲', title: 'Kod DİĞER TELEFONDA', body: `${phoneNumber} numarası zaten bir WhatsApp hesabına kayıtlı. 6 haneli kod SMS'e DEĞİL, o numaranın kayıtlı olduğu telefondaki WhatsApp'a gönderildi. Kodu o cihazdan okuyup buraya girin.` }
    : otpIsRateLimit
      ? { icon: '⏳', title: 'Geçici bekleme (rate-limit)', body: otpNote || `${phoneNumber} için WhatsApp geçici bekleme koydu. Süre dolunca kod gelir; geldiğinde buraya girin.` }
      : { icon: '📲', title: 'SMS doğrulama kodu bekleniyor', body: `${phoneNumber} numarasına SMS ile 6 haneli kod gelecek. Kod gelince buraya girin, ajan otomatik girer.` };

  // Tick the elapsed clock off the REAL start (startedAt) so it reflects true wall-time
  // since the registration began — surviving modal close/reopen and page reloads. When
  // we don't know the start yet (very first render before any event/history), fall back
  // to a local +1 counter so the timer still moves.
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

  const barColor = failed ? '#ef4444' : done ? '#22c55e' : isMethodSelect ? '#8b5cf6' : awaitingOtp ? '#38bdf8' : 'var(--accent, #6366f1)';

  // Cancel a stuck/blocked registration: flips the account to FAILED and clears the
  // device's WA-registration badge (API cancel handler), so the card stops showing
  // "Kod bekleniyor" and the WhatsApp button unlocks. Needed for terminal cases the
  // operator can't act on (number blocked / wall / wrong number) where there's no code
  // to enter.
  async function cancelRegistration() {
    if (cancelBusy) return;
    if (!window.confirm(`${phoneNumber} için WhatsApp kaydını iptal etmek istediğinize emin misiniz?`)) return;
    setCancelBusy(true);
    try {
      const res = await fetch(`/api/accounts/batch/accounts/${accountId}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setOtpMsg(b?.data?.message || b?.error || 'İptal edilemedi');
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setOtpMsg('İptal edilemedi (ağ hatası)');
    } finally {
      setCancelBusy(false);
    }
  }

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

  // Operator picked a verification method (SMS / Voice / Missed call). Re-dispatch so
  // the agent selects that row on the sheet and continues.
  async function submitMethod(kind: 'sms' | 'voice' | 'missed_call' | 'other_device') {
    if (otpBusy) return;
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch(`/api/accounts/whatsapp/register/${accountId}/verify-method`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: kind })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setOtpMsg(body?.data?.message || body?.error || 'Yöntem gönderilemedi'); return; }
      setOtpMsg('Yöntem seçildi — ajan devam ediyor…');
      setCurrent((c) => ({ ...c, step: 'verify', label: 'Doğrulama yöntemi uygulanıyor', percent: 80, status: 'RUNNING' }));
    } catch {
      setOtpMsg('Yöntem gönderilemedi (ağ hatası)');
    } finally {
      setOtpBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 'min(96vw, 640px)' }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><MessageCircle size={16} /> WhatsApp kaydı · {phoneNumber}</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {/* Proxy exit vs number-country check. WhatsApp bans a mismatch ("Login not
            available"), so surface it up front: green when the exit country matches the
            number, red when it doesn't, neutral when no proxy is attached yet. */}
        {(() => {
          const numCc = numberCountry(phoneNumber);
          // Prefer the agent's LIVE verified exit country over the static proxyCountry
          // prop. The agent tests the real exit IP at register-start and logs e.g.
          // "✓ Çıkış IP: 5.27.42.25 (TR, Istanbul) — numara ülkesiyle eşleşti"; the prop
          // is only the provision-time hint and is often empty on a fresh device, which
          // made the modal wrongly say "atanmadı" even though the agent DID route TR.
          const liveLine = [...logs].reverse().find((l) => /Çıkış IP/i.test(l.note ?? ''));
          const liveExit = liveLine ? (liveLine.note?.match(/\(([A-Z]{2})(?:,|\))/)?.[1] ?? null) : null;
          const exit = liveExit || ((proxyCountry ?? '').toUpperCase() || null);
          if (!exit) {
            return (
              <div className="proxy-check proxy-check-warn">
                <AlertTriangle size={14} /> Proxy çıkışı henüz doğrulanmadı — kayıt başlayınca agent gerçek çıkış IP'sini kontrol eder.
              </div>
            );
          }
          const match = numCc ? exit === numCc : true;
          return (
            <div className={`proxy-check ${match ? 'proxy-check-ok' : 'proxy-check-err'}`}>
              {match ? <Check size={14} /> : <AlertTriangle size={14} />}
              {match
                ? <>Proxy çıkışı <b>{exit}</b>{liveExit ? ' (doğrulandı)' : ''} · numara ({numCc ?? '—'}) ile eşleşiyor ✓</>
                : <>UYUMSUZLUK: proxy çıkışı <b>{exit}</b> ama numara <b>{numCc}</b> — WhatsApp banlar!</>}
            </div>
          );
        })()}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
          <span>{current.label}</span>
          <span style={{ opacity: 0.65 }}>%{current.percent} · {mmss(elapsed)}</span>
        </div>
        <span className="health-bar" style={{ display: 'block', marginBottom: 14 }}>
          <span className="health-bar-fill" style={{ width: `${current.percent}%`, background: barColor }} />
        </span>

        {/* OTP box — appears when the flow parks at the code step. The instruction
            adapts to the scenario (plain SMS / code-on-other-phone / rate-limit). */}
        {isMethodSelect && (
          <div style={{ border: '1px solid rgba(139,92,246,0.4)', borderLeft: '3px solid #8b5cf6', background: 'rgba(139,92,246,0.08)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              🔀 <strong>Doğrulama yöntemi seçin</strong>
              <div style={{ opacity: 0.85, marginTop: 4, lineHeight: 1.4 }}>
                {phoneNumber} için WhatsApp bir yöntem seçmenizi istiyor. Erişebildiğiniz kanalı seçin — ajan onu uygulayıp devam eder.
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {methodOptions.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  className="btn-primary"
                  disabled={otpBusy || o.locked}
                  title={o.locked ? `Kısıtlı${o.wait ? ` — ${o.wait}` : ''}` : `${o.label} ile doğrula`}
                  onClick={() => void submitMethod(o.kind)}
                  style={{ opacity: o.locked ? 0.5 : 1 }}
                >
                  {o.kind === 'sms' ? '💬' : o.kind === 'voice' ? '📞' : '📱'} {o.label}
                  {o.locked ? ` (kısıtlı${o.wait ? ` — ${o.wait}` : ''})` : ''}
                </button>
              ))}
            </div>
            {otpMsg ? <div style={{ fontSize: 12, marginTop: 8, color: otpMsg.startsWith('Yöntem seçildi') ? '#4ade80' : '#f87171' }}>{otpMsg}</div> : null}
          </div>
        )}

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
            {!done && !failed && !awaitingOtp && (
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
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
                disabled={cancelBusy}
                onClick={cancelRegistration}
                title="Kaydı iptal et — hesabı başarısız işaretler ve kart kilidini açar"
              >
                {cancelBusy ? 'İptal ediliyor…' : 'Kaydı İptal Et'}
              </button>
              <button type="button" className="btn-ghost" onClick={onClose}>Arka planda devam et</button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
