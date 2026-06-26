'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Mail, UserRound, RefreshCw, Phone, Copy, Check, Loader2, XCircle, Activity, PackageOpen, SlidersHorizontal, SignalHigh } from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat } from '../../components/hud';
import { BatchPanel } from './BatchPanel';

type ProviderStatus = {
  sms: { ok: boolean; detail: string };
  mail: { ok: boolean; detail: string };
  identity: { ok: boolean; detail: string };
};

type Identity = {
  fullName: string; firstName: string; lastName: string; gender: string;
  email: string; username: string; birthDate: string; age: number; phone: string;
  street: string; city: string; state: string; postcode: string; country: string; countryCode: string;
};

type SmsCountry = { id: number | string; title: string; code: string };
type SmsProject = { id: number | string; title: string; code: string };
type RentedNumber = { requestId: string; number: string };
type OtpResult = { status: 'waiting' | 'received' | 'cancelled' | 'expired'; code?: string };

// Friendly platform → matched against the provider's project list by title.
const PLATFORMS = ['WhatsApp', 'Instagram', 'Facebook', 'Telegram'];

// OTP durum → Türkçe etiket (semantik nokta korunur).
const OTP_LABEL: Record<OtpResult['status'], string> = {
  waiting: 'Bekleniyor…',
  received: 'Alındı',
  cancelled: 'İptal edildi',
  expired: 'Süresi doldu'
};

// Sağlayıcı durum noktası: null iken nötr (offline) gri, aksi halde online/error.
function Dot({ ok }: { ok: boolean | null }) {
  const cls = ok === null ? 'dot dot-offline' : ok ? 'dot dot-online' : 'dot dot-error';
  return <span className={cls} />;
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost btn-xs"
      title="Kopyala"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function AccountsView({ initialStatus }: { initialStatus: ProviderStatus | null }) {
  const [status, setStatus] = useState<ProviderStatus | null>(initialStatus);
  const [refreshing, setRefreshing] = useState(false);

  // Reference data
  const [countries, setCountries] = useState<SmsCountry[]>([]);
  const [projects, setProjects] = useState<SmsProject[]>([]);
  const [country, setCountry] = useState('');
  const [platform, setPlatform] = useState('WhatsApp');

  // Generated artefacts
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [inbox, setInbox] = useState<string | null>(null);
  const [rented, setRented] = useState<RentedNumber | null>(null);
  const [otp, setOtp] = useState<OtpResult | null>(null);
  const [polling, setPolling] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch('/api/accounts/providers/status');
      const j = await r.json();
      if (j.data) setStatus(j.data as ProviderStatus);
    } catch { /* ignore */ } finally { setRefreshing(false); }
  }, []);

  // Load SMS reference data (countries + projects) once.
  useEffect(() => {
    void (async () => {
      try {
        const [cRes, pRes] = await Promise.all([
          fetch('/api/accounts/sms/countries').then((r) => r.json()).catch(() => ({})),
          fetch('/api/accounts/sms/projects').then((r) => r.json()).catch(() => ({}))
        ]);
        if (Array.isArray(cRes.data)) {
          setCountries(cRes.data);
          const us = cRes.data.find((c: SmsCountry) => (c.code || '').toLowerCase() === 'us');
          setCountry(String((us ?? cRes.data[0])?.id ?? ''));
        }
        if (Array.isArray(pRes.data)) setProjects(pRes.data);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Resolve the chosen friendly platform to a provider project id by title match.
  function projectIdFor(name: string): string | null {
    const hit = projects.find((p) => (p.title || '').toLowerCase().includes(name.toLowerCase()));
    return hit ? String(hit.id) : null;
  }

  async function genIdentity() {
    setBusy('identity'); setErr(null);
    try {
      const sel = countries.find((c) => String(c.id) === country);
      const cc = (sel?.code || 'us').toUpperCase();
      const r = await fetch('/api/accounts/identity', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country: cc.length === 2 ? cc : 'US' })
      });
      const j = await r.json();
      if (!r.ok || !j.data) throw new Error('Kimlik üretilemedi');
      setIdentity(j.data as Identity);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Kimlik hatası'); }
    finally { setBusy(null); }
  }

  async function makeInbox() {
    setBusy('mail'); setErr(null);
    try {
      // Seed from the identity username when available, else a stable token.
      const seed = (identity?.username || identity?.firstName || 'inbox') + (identity?.birthDate?.replace(/-/g, '') ?? '');
      const r = await fetch('/api/accounts/mail/inbox', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seed })
      });
      const j = await r.json();
      if (!r.ok || !j.data?.address) throw new Error('E-posta oluşturulamadı');
      setInbox(j.data.address as string);
    } catch (e) { setErr(e instanceof Error ? e.message : 'E-posta hatası'); }
    finally { setBusy(null); }
  }

  async function rentNumber() {
    const projectId = projectIdFor(platform);
    if (!projectId) { setErr(`${platform} için sağlayıcıda servis bulunamadı`); return; }
    if (!country) { setErr('Önce ülke seçin'); return; }
    setBusy('number'); setErr(null); setOtp(null);
    try {
      const r = await fetch('/api/accounts/sms/number', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ countryId: country, projectId })
      });
      const j = await r.json();
      if (!r.ok || !j.data?.number) throw new Error(j.data?.message || 'Numara alınamadı');
      setRented(j.data as RentedNumber);
      startPolling((j.data as RentedNumber).requestId);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Numara hatası'); }
    finally { setBusy(null); }
  }

  function startPolling(requestId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/accounts/sms/number/${requestId}/otp`);
        const j = await r.json();
        const res = j.data as OtpResult;
        setOtp(res);
        if (res?.status === 'received') { setPolling(false); if (pollRef.current) clearInterval(pollRef.current); }
      } catch { /* keep polling */ }
    }, 4000);
  }

  async function cancelNumber() {
    if (!rented) return;
    if (pollRef.current) clearInterval(pollRef.current);
    setPolling(false);
    try { await fetch(`/api/accounts/sms/number/${rented.requestId}/cancel`, { method: 'POST' }); } catch { /* ignore */ }
    setRented(null); setOtp(null);
  }

  const s = status;
  const onlineCount = (s ? Number(!!s.sms.ok) + Number(!!s.mail.ok) + Number(!!s.identity.ok) : 0);
  const allOnline = !!s && s.sms.ok && s.mail.ok && s.identity.ok;
  return (
    <>
      <HoloHeader
        eyebrow="HESAP FABRİKASI"
        title="Hesap Fabrikası"
        subtitle="SMS, e-posta ve kimlik sağlayıcılarını tek panelden yönet; OTP'yi otomatik bekle."
        actions={(
          <button type="button" className="btn-ghost" disabled={refreshing} onClick={refreshStatus} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Durumu yenile
          </button>
        )}
      />

      {/* Provider status deck */}
      <div className="holo-stats-grid">
        <HoloStat
          tone={s ? (s.sms.ok ? 'success' : 'error') : 'neutral'}
          icon={<Smartphone size={15} />}
          label="SMS · sms-bus"
          value={<span className="icon-row" style={{ gap: 8 }}><Dot ok={s ? s.sms.ok : null} /> {s ? (s.sms.ok ? 'Bağlı' : 'Bağlı değil') : 'Yükleniyor…'}</span>}
          sub={s ? (s.sms.detail || '—') : 'Bilinmiyor'}
        />
        <HoloStat
          tone={s ? (s.mail.ok ? 'success' : 'error') : 'neutral'}
          icon={<Mail size={15} />}
          label="E-posta · catchmail"
          value={<span className="icon-row" style={{ gap: 8 }}><Dot ok={s ? s.mail.ok : null} /> {s ? (s.mail.ok ? 'Bağlı' : 'Bağlı değil') : 'Yükleniyor…'}</span>}
          sub={s ? (s.mail.detail || '—') : 'Bilinmiyor'}
        />
        <HoloStat
          tone={s ? (s.identity.ok ? 'success' : 'error') : 'neutral'}
          icon={<UserRound size={15} />}
          label="Kimlik · randomuser"
          value={<span className="icon-row" style={{ gap: 8 }}><Dot ok={s ? s.identity.ok : null} /> {s ? (s.identity.ok ? 'Bağlı' : 'Bağlı değil') : 'Yükleniyor…'}</span>}
          sub={s ? (s.identity.detail || '—') : 'Bilinmiyor'}
        />
        <HoloStat
          tone={s ? (allOnline ? 'cyan' : 'warning') : 'neutral'}
          icon={<SignalHigh size={15} />}
          label="Aktif sağlayıcı"
          value={<span className="mono">{s ? `${onlineCount}/3` : '—/3'}</span>}
          sub={s ? (allOnline ? 'Tüm kanallar çevrimiçi' : 'Bazı kanallar kapalı') : 'Bilinmiyor'}
        />
      </div>

      {err ? <p className="field-error" style={{ marginTop: 12 }}>{err}</p> : null}

      {/* Builder */}
      <section className="holo-grid-2" style={{ marginTop: 16 }}>
        {/* Controls */}
        <HoloPanel title="Hesap hazırla" icon={<SlidersHorizontal size={16} />} tilt>
          <div className="field-row">
            <label className="field">
              <span>Platform</span>
              <select className="field-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Ülke</span>
              <select className="field-input" value={country} onChange={(e) => setCountry(e.target.value)}>
                {countries.length === 0 ? <option value="">— yükleniyor —</option> :
                  countries.map((c) => <option key={String(c.id)} value={String(c.id)}>{c.title} ({c.code})</option>)}
              </select>
            </label>
          </div>

          <div className="wf-actions" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn-ghost" disabled={busy === 'identity'} onClick={genIdentity} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy === 'identity' ? <Loader2 size={14} className="spin" /> : <UserRound size={14} />} Kimlik üret
            </button>
            <button type="button" className="btn-ghost" disabled={busy === 'mail'} onClick={makeInbox} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy === 'mail' ? <Loader2 size={14} className="spin" /> : <Mail size={14} />} E-posta oluştur
            </button>
            <button type="button" className="btn-primary" disabled={busy === 'number' || !!rented} onClick={rentNumber} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {busy === 'number' ? <Loader2 size={14} className="spin" /> : <Phone size={14} />} Numara al
            </button>
          </div>
          <p className="helper" style={{ marginTop: 8 }}>
            Numara alındığında OTP otomatik beklenir. sms-bus bakiyesinden ücret düşer; gelmezse iptal edip iade alabilirsiniz.
          </p>
        </HoloPanel>

        {/* Result */}
        <HoloPanel title="Hesap paketi" icon={<PackageOpen size={16} />} tilt>
          <div className="panel-stack">
            {/* Number + OTP */}
            <div className="row">
              <span><Phone size={13} /> Numara</span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {rented ? <>+{rented.number} <CopyBtn value={rented.number} /></> : '—'}
              </span>
            </div>
            <div className="row">
              <span>OTP kodu</span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {otp?.status === 'received' ? (
                  <><span className="dot dot-online" /> <strong>{otp.code}</strong> <CopyBtn value={otp.code!} /></>
                ) : polling ? (
                  <><span className="dot dot-busy" /> <Loader2 size={13} className="spin" /> {OTP_LABEL.waiting}</>
                ) : otp?.status === 'cancelled' ? (
                  <><span className="dot dot-error" /> {OTP_LABEL.cancelled}</>
                ) : otp?.status === 'expired' ? (
                  <><span className="dot dot-error" /> {OTP_LABEL.expired}</>
                ) : '—'}
                {rented && otp?.status !== 'received' ? (
                  <button type="button" className="btn-ghost btn-xs" onClick={cancelNumber} title="İptal et"><XCircle size={12} /></button>
                ) : null}
              </span>
            </div>
            {/* Email */}
            <div className="row">
              <span><Mail size={13} /> E-posta</span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {inbox ? <>{inbox} <CopyBtn value={inbox} /></> : '—'}
              </span>
            </div>
            {/* Identity */}
            {identity ? (
              <>
                <div className="row"><span><UserRound size={13} /> Ad</span><span className="helper">{identity.fullName} · {identity.gender}</span></div>
                <div className="row"><span>Doğum / Yaş</span><span className="helper mono">{identity.birthDate} · {identity.age}</span></div>
                <div className="row"><span>Adres</span><span className="helper">{identity.street}, {identity.city}, {identity.state} {identity.postcode}</span></div>
                <div className="row"><span>Kullanıcı adı</span><span className="mono helper" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{identity.username} <CopyBtn value={identity.username} /></span></div>
              </>
            ) : (
              <div className="row"><span><UserRound size={13} /> Kimlik</span><span className="helper">—</span></div>
            )}
          </div>
        </HoloPanel>
      </section>

      {/* Batch farm */}
      <HoloPanel title="Toplu üretim" icon={<Activity size={16} />} className="holo-batch" scan>
        <BatchPanel />
      </HoloPanel>
    </>
  );
}
