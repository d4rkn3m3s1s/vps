'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, RefreshCw, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';

type Device = { id: string; name: string; online: boolean };
type WaMessage = {
  id: string;
  direction: 'IN' | 'OUT';
  peer: string;
  body: string;
  waTimestamp: string;
  createdAt: string;
};

const POLL_MS = 4000;

export function WhatsappView({ devices }: { devices: Device[] }) {
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id ?? '');
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const device = useMemo(() => devices.find((d) => d.id === deviceId) ?? null, [devices, deviceId]);

  const load = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/whatsapp/messages?deviceId=${encodeURIComponent(deviceId)}&limit=200`);
      const json = await res.json();
      const rows = (json?.data?.messages ?? []) as WaMessage[];
      // Backend returns newest-first; show oldest→newest (chat order).
      setMessages(rows.slice().reverse());
    } catch {
      /* ignore transient poll errors */
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  // Poll the message history for the selected device.
  useEffect(() => {
    setMessages([]);
    if (!deviceId) return;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [deviceId, load]);

  // Keep the conversation scrolled to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    if (!deviceId || !to.trim() || !body.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/accounts/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, to: to.trim(), message: body.trim() })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setNotice(`Gönderilemedi: ${j?.error?.message ?? res.status}`);
      } else {
        setNotice('Mesaj sıraya alındı — cihaz gönderiyor. Birazdan geçmişte görünecek.');
        setBody('');
        // Give the agent a moment, then refresh so the OUT row shows up.
        setTimeout(() => void load(), 4000);
      }
    } catch {
      setNotice('Ağ hatası — tekrar deneyin.');
    } finally {
      setSending(false);
    }
  }

  const inCount = messages.filter((m) => m.direction === 'IN').length;
  const outCount = messages.filter((m) => m.direction === 'OUT').length;

  return (
    <>
      <HoloHeader
        eyebrow="Mesajlaşma"
        title="WhatsApp"
        subtitle="Cihaz seçin, gelen mesajları okuyun ve mesaj gönderin. Gelen mesajlar Telegram'a da bildirilir."
        actions={
          <select
            className="inline-select"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            {devices.length === 0 ? <option value="">Cihaz yok</option> : null}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.online ? '· çevrimiçi' : '· çevrimdışı'}
              </option>
            ))}
          </select>
        }
      />

      <div className="holo-stats-grid" style={{ marginBottom: '1rem' }}>
        <HoloStat label="Cihaz" value={<span className="mono">{device?.name ?? '—'}</span>} />
        <HoloStat label="Toplam mesaj" value={<span className="mono">{messages.length}</span>} />
        <HoloStat label="Gelen" value={<span className="mono">{inCount}</span>} />
        <HoloStat label="Giden" value={<span className="mono">{outCount}</span>} />
      </div>

      <div className="wa-grid">
        {/* Conversation history */}
        <HoloPanel
          title="Mesajlar"
          actions={
            <button type="button" className="btn-ghost btn-xs" onClick={() => void load()} disabled={!deviceId}>
              <RefreshCw size={13} className={loading ? 'spin' : ''} /> Yenile
            </button>
          }
        >
          <div className="wa-messages" ref={listRef}>
            {!deviceId ? (
              <p className="helper">Önce bir cihaz seçin.</p>
            ) : messages.length === 0 ? (
              <p className="helper">Henüz mesaj yok. Gelen mesajlar otomatik yakalanır (her {POLL_MS / 1000}s yenilenir).</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`wa-bubble ${m.direction === 'OUT' ? 'wa-out' : 'wa-in'}`}>
                  <div className="wa-bubble-head">
                    <span className="wa-peer">
                      {m.direction === 'OUT' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />} {m.peer}
                    </span>
                    <span className="wa-time mono">{new Date(m.waTimestamp).toLocaleString('tr-TR')}</span>
                  </div>
                  <div className="wa-body">{m.body}</div>
                </div>
              ))
            )}
          </div>
        </HoloPanel>

        {/* Compose */}
        <HoloPanel title="Mesaj gönder">
          <div className="wa-compose">
            <label className="field">
              <span>Alıcı numara (ülke kodu ile)</span>
              <input
                className="field-input"
                placeholder="905551112233"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                inputMode="tel"
              />
            </label>
            <label className="field">
              <span>Mesaj</span>
              <textarea
                className="field-input"
                rows={4}
                placeholder="Mesajınız…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!deviceId || !to.trim() || !body.trim() || sending}
              onClick={() => void send()}
            >
              <Send size={14} /> {sending ? 'Gönderiliyor…' : 'Gönder'}
            </button>
            {notice ? <p className="helper" style={{ marginTop: '0.6rem' }}>{notice}</p> : null}
            <p className="helper" style={{ marginTop: '0.8rem', opacity: 0.7 }}>
              İpucu: numara wa.me formatında, + ve boşluk olmadan (örn. 905551112233). Alıcı kayıtlı olmasa da çalışır.
            </p>
          </div>
        </HoloPanel>
      </div>
    </>
  );
}
