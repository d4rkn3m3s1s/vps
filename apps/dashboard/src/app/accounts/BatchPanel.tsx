'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Play, Trash2, RefreshCw, Copy, Check, UserPlus, MessageCircle, X, Send, Inbox } from 'lucide-react';

type Account = {
  id: string;
  batchId: string | null;
  platform: string;
  status: string;
  fullName: string | null;
  gender: string | null;
  birthDate: string | null;
  countryCode: string | null;
  emailAddress: string | null;
  username: string | null;
  phoneNumber: string | null;
  otpCode: string | null;
  error: string | null;
};

const PLATFORMS = ['whatsapp', 'instagram', 'facebook'];

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Beklemede',
  IDENTITY_READY: 'Kimlik hazır',
  CONTACT_READY: 'İletişim hazır',
  AWAITING_OTP: 'OTP bekleniyor',
  REGISTERING: 'Kaydediliyor',
  ACTIVE: 'Aktif',
  FAILED: 'Başarısız'
};

function statusDot(s: string): string {
  if (s === 'ACTIVE') return 'dot dot-online';
  if (s === 'FAILED') return 'dot dot-error';
  if (s === 'PENDING') return 'dot dot-offline';
  return 'dot dot-busy';
}

function Copyable({ value }: { value: string | null }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="helper">—</span>;
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {value}
      <button type="button" className="btn-ghost btn-xs" title="Kopyala" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* ignore */ }
      }}>{done ? <Check size={11} /> : <Copy size={11} />}</button>
    </span>
  );
}

type DeviceLite = { id: string; name: string; status: string };

export function BatchPanel() {
  const [platform, setPlatform] = useState('whatsapp');
  const [count, setCount] = useState(5);
  const [country, setCountry] = useState('US');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [devices, setDevices] = useState<DeviceLite[]>([]);
  const [device, setDevice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // WhatsApp messaging modal: which account, recipient, body, last-read result.
  const [waChat, setWaChat] = useState<Account | null>(null);
  const [waTo, setWaTo] = useState('');
  const [waMsg, setWaMsg] = useState('');
  const [waRead, setWaRead] = useState<string[] | null>(null);
  const [waBusy, setWaBusy] = useState<'send' | 'read' | null>(null);
  const [waErr, setWaErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/accounts/batch/accounts');
      const j = await r.json();
      if (Array.isArray(j.data)) setAccounts(j.data as Account[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Load devices so the operator can pick where to run the on-device signup.
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/devices');
        const j = await r.json();
        const list = (Array.isArray(j.data) ? j.data : []) as DeviceLite[];
        setDevices(list);
        const online = list.find((d) => d.status === 'ONLINE');
        if (online) setDevice(online.id);
        else if (list[0]) setDevice(list[0].id);
      } catch { /* ignore */ }
    })();
  }, []);

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 4000); }

  // Run the real on-device Instagram signup for one account.
  async function register(id: string) {
    if (!device) { setErr('Önce bir cihaz seçin'); return; }
    setBusy(id); setErr(null);
    try {
      const r = await fetch(`/api/accounts/batch/accounts/${id}/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: device })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.data?.message || 'Kayıt başlatılamadı');
      flash('Cihazda kayıt başlatıldı — durum güncellenecek.');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Hata'); }
    finally { setBusy(null); }
  }

  async function createBatch() {
    setBusy('create'); setErr(null);
    try {
      const r = await fetch('/api/accounts/batch', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, count, countryCode: country })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.data?.message || 'Batch oluşturulamadı');
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Hata'); }
    finally { setBusy(null); }
  }

  async function provision(id: string) {
    setBusy(id); setErr(null);
    try {
      await fetch(`/api/accounts/batch/accounts/${id}/provision`, { method: 'POST' });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Hata'); }
    finally { setBusy(null); }
  }

  async function pollOtp(id: string) {
    setBusy(id);
    try { await fetch(`/api/accounts/batch/accounts/${id}/otp`); await load(); }
    catch { /* ignore */ } finally { setBusy(null); }
  }

  async function remove(id: string) {
    setBusy(id);
    try { await fetch(`/api/accounts/batch/accounts/${id}`, { method: 'DELETE' }); await load(); }
    catch { /* ignore */ } finally { setBusy(null); }
  }

  function openWaChat(a: Account) {
    setWaChat(a); setWaTo(''); setWaMsg(''); setWaRead(null); setWaErr(null);
  }

  // Dispatch a WhatsApp send job; the agent opens the wa.me chat and taps Send.
  async function waSend() {
    if (!waChat) return;
    if (!waTo.trim() || !waMsg.trim()) { setWaErr('Numara ve mesaj gerekli'); return; }
    setWaBusy('send'); setWaErr(null);
    try {
      const r = await fetch(`/api/accounts/batch/accounts/${waChat.id}/whatsapp/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: waTo.replace(/[^\d]/g, ''), message: waMsg })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.data?.message || 'Mesaj gönderilemedi');
      flash('Mesaj gönderme işi cihaza gönderildi.');
      setWaMsg('');
    } catch (e) { setWaErr(e instanceof Error ? e.message : 'Hata'); }
    finally { setWaBusy(null); }
  }

  // Dispatch a WhatsApp read job, then poll the resulting job for the messages.
  async function waReadMsgs() {
    if (!waChat) return;
    if (!waTo.trim()) { setWaErr('Okumak için numara girin'); return; }
    setWaBusy('read'); setWaErr(null); setWaRead(null);
    try {
      const r = await fetch(`/api/accounts/batch/accounts/${waChat.id}/whatsapp/read`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: waTo.replace(/[^\d]/g, '') })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.data?.message || 'Okuma başlatılamadı');
      const jobId = j.data?.job?.id as string | undefined;
      if (!jobId) { flash('Okuma işi gönderildi.'); return; }
      // Poll the job until the agent reports back with the messages.
      const msgs = await pollJobMessages(jobId);
      setWaRead(msgs);
      if (msgs.length === 0) flash('Okundu — görünür mesaj yok.');
    } catch (e) { setWaErr(e instanceof Error ? e.message : 'Hata'); }
    finally { setWaBusy(null); }
  }

  // Poll a job's result for up to ~30s; returns the messages array when ready.
  async function pollJobMessages(jobId: string): Promise<string[]> {
    for (let i = 0; i < 15; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      try {
        const r = await fetch(`/api/jobs/${jobId}`);
        const j = await r.json();
        const job = j.data;
        if (job?.status === 'COMPLETED') {
          const result = job.result ?? job.output ?? {};
          const msgs = Array.isArray(result.messages) ? result.messages : [];
          return msgs as string[];
        }
        if (job?.status === 'FAILED') throw new Error(job.error || 'İş başarısız');
      } catch { /* keep polling */ }
    }
    return [];
  }

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      {toast ? <div className="toast toast-ok">{toast}</div> : null}
      <h2><Layers size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Toplu Hesap Üretimi</h2>
      <p className="helper" style={{ marginBottom: 10 }}>
        Bir platform için N hesap oluşturun; her hesaba otomatik ad/soyad/doğum + e-posta + numara doldurulur. “Hazırla” numarayı kiralar (sms-bus bakiyesinden ücret düşer) ve OTP otomatik beklenir.
      </p>

      <div className="field-row">
        <label className="field">
          <span>Platform</span>
          <select className="field-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Adet</span>
          <input className="field-input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Ülke (2 harf)</span>
          <input className="field-input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
        </label>
        <label className="field">
          <span>Kayıt cihazı</span>
          <select className="field-input" value={device} onChange={(e) => setDevice(e.target.value)}>
            {devices.length === 0 ? <option value="">— cihaz yok —</option> :
              devices.map((d) => <option key={d.id} value={d.id}>{d.name} {d.status === 'ONLINE' ? '🟢' : ''}</option>)}
          </select>
        </label>
      </div>
      <p className="helper" style={{ marginTop: 4 }}>
        Not: Otomatik “Cihazda kayıt” <strong>Instagram</strong> (e-posta ile) ve <strong>WhatsApp</strong> (numara + SMS OTP ile) için çalışır. WhatsApp kaydı gerçek SMS doğrulaması ister; emülatörde cihaz bütünlük kontrolüne takılabilir, en yüksek başarı gerçek ARM cihazdadır. Kayıt sonrası WhatsApp hesaplarından <strong>mesaj gönderip okuyabilirsiniz</strong>.
      </p>

      <div className="wf-actions" style={{ marginTop: 8, gap: 8 }}>
        <button type="button" className="btn-primary" disabled={busy === 'create'} onClick={createBatch} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {busy === 'create' ? <Loader2 size={14} className="spin" /> : <Layers size={14} />} {count} hesap oluştur
        </button>
        <button type="button" className="btn-ghost" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Yenile
        </button>
      </div>

      {err ? <p className="field-error" style={{ marginTop: 10 }}>{err}</p> : null}

      <div className="profile-table-wrap" style={{ marginTop: 14 }}>
        <table className="profile-table">
          <thead>
            <tr>
              <th>Durum</th><th>Platform</th><th>Ad</th><th>Doğum</th><th>E-posta</th><th>Numara</th><th>OTP</th><th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={8}><div className="table-empty"><span>Henüz hesap yok — yukarıdan bir batch oluşturun.</span></div></td></tr>
            ) : accounts.map((a) => (
              <tr key={a.id}>
                <td><span className="status-chip"><span className={statusDot(a.status)} />{STATUS_LABEL[a.status] ?? a.status}</span>
                  {a.error ? <div className="helper live-err" style={{ fontSize: '0.7rem' }}>{a.error}</div> : null}
                </td>
                <td>{a.platform}</td>
                <td>{a.fullName ?? <span className="helper">—</span>}{a.gender ? <div className="helper" style={{ fontSize: '0.7rem' }}>{a.gender}</div> : null}</td>
                <td className="mono helper">{a.birthDate ?? '—'}</td>
                <td><Copyable value={a.emailAddress} /></td>
                <td><Copyable value={a.phoneNumber} /></td>
                <td>{a.otpCode ? <strong className="mono">{a.otpCode}</strong> : a.status === 'AWAITING_OTP' ? <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id} onClick={() => pollOtp(a.id)}>OTP çek</button> : <span className="helper">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.status === 'PENDING' || a.status === 'IDENTITY_READY' || a.status === 'CONTACT_READY' ? (
                    <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id} onClick={() => provision(a.id)} title="Hazırla">
                      {busy === a.id ? <Loader2 size={11} className="spin" /> : <Play size={11} />} Hazırla
                    </button>
                  ) : null}
                  {/* On-device signup — Instagram (email) + WhatsApp (phone+OTP). */}
                  {((a.platform === 'instagram' && a.emailAddress) || (a.platform === 'whatsapp' && a.phoneNumber)) && a.status !== 'ACTIVE' ? (
                    <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id || !device} onClick={() => register(a.id)} title="Cihazda kayıt aç">
                      {busy === a.id ? <Loader2 size={11} className="spin" /> : <UserPlus size={11} />} Cihazda aç
                    </button>
                  ) : null}
                  {/* WhatsApp messaging — once the account exists on a device. */}
                  {a.platform === 'whatsapp' && (a.status === 'ACTIVE' || a.status === 'REGISTERING') ? (
                    <button type="button" className="btn-ghost btn-xs" onClick={() => openWaChat(a)} title="Mesaj gönder / oku">
                      <MessageCircle size={11} /> Mesaj
                    </button>
                  ) : null}
                  <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id} onClick={() => remove(a.id)} title="Sil"><Trash2 size={11} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* WhatsApp messaging modal */}
      {waChat ? (
        <div className="modal-overlay" onClick={() => setWaChat(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MessageCircle size={16} /> WhatsApp — {waChat.fullName || waChat.phoneNumber || waChat.id}
              </h3>
              <button type="button" className="modal-close" onClick={() => setWaChat(null)}><X size={16} /></button>
            </header>

            <div style={{ padding: '4px 0' }}>
              <p className="helper" style={{ marginBottom: 10 }}>
                Gönderen hesap numarası: <span className="mono">{waChat.phoneNumber ?? '—'}</span>.
                Mesaj/okuma işi bağlı cihazda çalışır (wa.me bağlantısıyla, kişi kayıtlı olmasa da).
              </p>

              <label className="field" style={{ marginBottom: 8 }}>
                <span>Alıcı numara (ülke kodu ile, + olmadan)</span>
                <input className="field-input" placeholder="905xxxxxxxxx" value={waTo}
                  onChange={(e) => setWaTo(e.target.value)} />
              </label>

              <label className="field" style={{ marginBottom: 8 }}>
                <span>Mesaj</span>
                <textarea className="field-input" rows={3} placeholder="Merhaba…" value={waMsg}
                  onChange={(e) => setWaMsg(e.target.value)} />
              </label>

              {waErr ? <p className="field-error">{waErr}</p> : null}

              <div className="wf-actions" style={{ gap: 8, marginTop: 6 }}>
                <button type="button" className="btn-primary" disabled={waBusy !== null} onClick={waSend}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {waBusy === 'send' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Gönder
                </button>
                <button type="button" className="btn-ghost" disabled={waBusy !== null} onClick={waReadMsgs}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {waBusy === 'read' ? <Loader2 size={14} className="spin" /> : <Inbox size={14} />} Mesajları oku
                </button>
              </div>

              {waRead ? (
                <div className="panel" style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto' }}>
                  <p className="helper" style={{ marginBottom: 6 }}>Okunan mesajlar ({waRead.length}):</p>
                  {waRead.length === 0 ? <p className="helper">— görünür mesaj yok —</p> :
                    waRead.map((m, i) => (
                      <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
                        <span className="helper mono" style={{ minWidth: 22 }}>{i + 1}</span>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{m}</span>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
