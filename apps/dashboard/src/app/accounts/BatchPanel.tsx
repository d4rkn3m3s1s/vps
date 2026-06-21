'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Play, Trash2, RefreshCw, Copy, Check, UserPlus } from 'lucide-react';

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
        Not: Otomatik “Cihazda kayıt” şu an <strong>Instagram</strong> (e-posta ile) içindir. WhatsApp/numara akışı SMS ücreti + manuel onay gerektirir.
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
                  {/* On-device signup — Instagram only (email-based, automated). */}
                  {a.platform === 'instagram' && a.emailAddress && a.status !== 'ACTIVE' ? (
                    <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id || !device} onClick={() => register(a.id)} title="Cihazda kayıt aç">
                      {busy === a.id ? <Loader2 size={11} className="spin" /> : <UserPlus size={11} />} Cihazda aç
                    </button>
                  ) : null}
                  <button type="button" className="btn-ghost btn-xs" disabled={busy === a.id} onClick={() => remove(a.id)} title="Sil"><Trash2 size={11} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
