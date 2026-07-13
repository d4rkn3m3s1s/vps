'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Network, Check, Loader2, Globe, ShieldCheck, ShieldAlert, Search } from 'lucide-react';

type Proxy = {
  id: string;
  label: string;
  host: string;
  port: number;
  type: string;
  username?: string | null;
  countryCode?: string | null;
  country?: string | null;
  status?: string | null;
  score?: number | null;
  exportIp?: string | null;
  group?: string | null;
};

type ProviderProxy = Proxy;
type CountryOpt = { code: string; name: string };

type Props = {
  deviceId: string;
  deviceName: string;
  currentProxyId?: string | null;
  currentCountry?: string | null;
  onClose: () => void;
  onAssigned?: () => void;
};

// ISO-2 → flag emoji.
function flag(cc?: string | null): string {
  if (!cc || cc.length !== 2) return '🌐';
  const base = 0x1f1e6;
  const A = 'A'.charCodeAt(0);
  const up = cc.toUpperCase();
  return String.fromCodePoint(base + (up.charCodeAt(0) - A), base + (up.charCodeAt(1) - A));
}

export default function DeviceProxyModal({ deviceId, deviceName, currentProxyId, currentCountry, onClose, onAssigned }: Props) {
  const [tab, setTab] = useState<'country' | 'saved'>('country');

  // Provider (country-select) state.
  const [providers, setProviders] = useState<ProviderProxy[]>([]);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(currentCountry ?? null);
  const [cQuery, setCQuery] = useState('');

  // Saved-proxy state.
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [savedSel, setSavedSel] = useState<string | null>(currentProxyId ?? null);
  const [sQuery, setSQuery] = useState('');
  const [verify, setVerify] = useState<Record<string, { busy?: boolean; ok?: boolean; exitIp?: string; country?: string; note?: string }>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pr, co, px] = await Promise.all([
          fetch('/api/proxies/providers').then((r) => r.json()).catch(() => ({})),
          fetch('/api/proxies/countries').then((r) => r.json()).catch(() => ({})),
          fetch('/api/proxies').then((r) => r.json()).catch(() => ({}))
        ]);
        if (!alive) return;
        const provList: ProviderProxy[] = Array.isArray(pr?.data) ? pr.data : [];
        setProviders(provList);
        if (provList[0]) setProviderId(provList[0].id);
        setCountries(Array.isArray(co?.data) ? co.data : []);
        // Saved proxies = everything that ISN'T a provider template.
        const all: Proxy[] = Array.isArray(px?.data) ? px.data : [];
        setProxies(all.filter((p) => p.group !== 'provider'));
        // If there are no providers, default to the saved tab.
        if (provList.length === 0) setTab('saved');
      } catch {
        if (alive) setMsg({ kind: 'err', text: 'Proxy verileri yüklenemedi.' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const filteredCountries = useMemo(() => {
    const q = cQuery.trim().toLowerCase();
    return !q ? countries : countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countries, cQuery]);

  const groupedSaved = useMemo(() => {
    const q = sQuery.trim().toLowerCase();
    const filtered = proxies.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.host.toLowerCase().includes(q) || (p.countryCode ?? '').toLowerCase().includes(q)
    );
    const map = new Map<string, Proxy[]>();
    for (const p of filtered) {
      const key = p.countryCode || 'ZZ';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort((a, b) => (a[0] === 'ZZ' ? 1 : b[0] === 'ZZ' ? -1 : a[0].localeCompare(b[0])));
  }, [proxies, sQuery]);

  async function assignCountry() {
    if (!providerId || !country || busy) { setMsg({ kind: 'err', text: 'Sağlayıcı ve ülke seçin.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/proxies/assign-country', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId, providerId, countryCode: country })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: 'err', text: body?.data?.message || body?.error || 'Proxy gömülemedi' }); return; }
      const cc = body?.data?.country ?? country;
      setMsg({ kind: 'ok', text: `${flag(cc)} ${cc} proxy'si cihaza gömüldü (redsocks). Ekran ~30sn içinde bu ülke IP'sine geçer.` });
      onAssigned?.();
    } catch {
      setMsg({ kind: 'err', text: 'Proxy gömülemedi (ağ hatası)' });
    } finally {
      setBusy(false);
    }
  }

  async function assignSaved() {
    if (!savedSel || busy) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/bulk/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceIds: [deviceId], proxyId: savedSel })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: 'err', text: body?.data?.message || body?.error || 'Proxy atanamadı' }); return; }
      setMsg({ kind: 'ok', text: 'Proxy cihaza gömüldü (redsocks + iptables).' });
      onAssigned?.();
    } catch {
      setMsg({ kind: 'err', text: 'Proxy atanamadı (ağ hatası)' });
    } finally {
      setBusy(false);
    }
  }

  async function verifyProxy(id: string) {
    setVerify((v) => ({ ...v, [id]: { ...v[id], busy: true } }));
    try {
      const res = await fetch(`/api/proxies/${id}/check`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      const d = body?.data ?? {};
      const exit = d.exportIp ?? d.exitIp ?? null;
      setVerify((v) => ({
        ...v,
        [id]: {
          busy: false,
          ok: d.status === 'OK',
          ...(exit ? { exitIp: exit } : {}),
          ...(d.countryCode ? { country: d.countryCode } : {}),
          ...(d.status === 'FAILED' ? { note: 'çıkış IP alınamadı' } : {})
        }
      }));
    } catch {
      setVerify((v) => ({ ...v, [id]: { busy: false, ok: false, note: 'Kontrol edilemedi' } }));
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2><Network size={16} /> Proxy göm — {deviceName}</h2>
          <button type="button" className="modal-close" onClick={onClose}><X size={16} /></button>
        </header>

        {/* Tabs */}
        <div className="proxy-tabs">
          <button type="button" className={`proxy-tab${tab === 'country' ? ' is-active' : ''}`} onClick={() => setTab('country')}>
            <Globe size={14} /> Ülke seç (sağlayıcı)
          </button>
          <button type="button" className={`proxy-tab${tab === 'saved' ? ' is-active' : ''}`} onClick={() => setTab('saved')}>
            <Network size={14} /> Kayıtlı proxyler {proxies.length ? `(${proxies.length})` : ''}
          </button>
        </div>

        {loading ? (
          <div className="proxy-empty"><Loader2 size={18} className="spin" /> Yükleniyor…</div>
        ) : tab === 'country' ? (
          providers.length === 0 ? (
            <div className="proxy-empty">Kayıtlı sağlayıcı yok. Proxyler sayfasından bir sağlayıcı hesabı ekleyin (grup: provider).</div>
          ) : (
            <>
              {providers.length > 1 ? (
                <label className="field" style={{ marginBottom: 8 }}>
                  <span>Sağlayıcı</span>
                  <select className="field-input" value={providerId ?? ''} onChange={(e) => setProviderId(e.target.value)}>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.host}</option>)}
                  </select>
                </label>
              ) : (
                <p className="helper" style={{ margin: '0 0 8px' }}>Sağlayıcı: <b>{providers[0]?.label}</b> ({providers[0]?.host})</p>
              )}

              <div className="proxy-search">
                <Search size={14} />
                <input className="field-input" placeholder="Ülke ara…" value={cQuery} onChange={(e) => setCQuery(e.target.value)} />
              </div>

              <div className="proxy-country-grid">
                {filteredCountries.map((c) => (
                  <button
                    type="button"
                    key={c.code}
                    className={`proxy-country-cell${country === c.code ? ' is-selected' : ''}`}
                    onClick={() => setCountry(c.code)}
                  >
                    <span className="proxy-flag">{flag(c.code)}</span>
                    <span className="proxy-country-name">{c.name}</span>
                    <span className="proxy-country-code mono">{c.code}</span>
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <div className="proxy-search">
              <Search size={14} />
              <input className="field-input" placeholder="Ülke, etiket veya host ara…" value={sQuery} onChange={(e) => setSQuery(e.target.value)} />
            </div>
            <div className="proxy-list">
              {groupedSaved.length === 0 ? (
                <div className="proxy-empty">Kayıtlı proxy yok. Proxyler sayfasından ekleyin/içe aktarın.</div>
              ) : (
                groupedSaved.map(([cc, list]) => (
                  <div key={cc} className="proxy-group">
                    <div className="proxy-group-head">
                      <span className="proxy-flag">{flag(cc === 'ZZ' ? null : cc)}</span>
                      <span>{cc === 'ZZ' ? 'Ülke belirtilmemiş' : (list[0]?.country || cc)}</span>
                      <span className="proxy-group-count">{list.length}</span>
                    </div>
                    {list.map((p) => {
                      const v = verify[p.id];
                      const isSel = savedSel === p.id;
                      return (
                        <label key={p.id} className={`proxy-row${isSel ? ' is-selected' : ''}`}>
                          <input type="radio" name="savedproxy" checked={isSel} onChange={() => setSavedSel(p.id)} />
                          <span className="proxy-flag">{flag(p.countryCode)}</span>
                          <div className="proxy-row-main">
                            <div className="proxy-row-label">{p.label}{currentProxyId === p.id ? <span className="proxy-current-tag">atanmış</span> : null}</div>
                            <div className="proxy-row-sub mono">{p.host}:{p.port} · {p.type}</div>
                          </div>
                          <span className={`proxy-status proxy-status-${(p.status ?? '').toLowerCase() || 'unknown'}`}>
                            {p.status === 'OK' ? <ShieldCheck size={12} /> : p.status === 'FAILED' ? <ShieldAlert size={12} /> : <Globe size={12} />}
                            {p.status ?? '—'}
                          </span>
                          <button type="button" className="proxy-verify-btn" onClick={(e) => { e.preventDefault(); void verifyProxy(p.id); }} title="Çıkış IP doğrula">
                            {v?.busy ? <Loader2 size={12} className="spin" /> : 'Teyit'}
                          </button>
                          {v && !v.busy ? (
                            <span className={`proxy-verify-res ${v.ok ? 'ok' : 'err'}`}>
                              {v.ok ? <Check size={12} /> : <ShieldAlert size={12} />}
                              {v.exitIp ? `${v.exitIp}${v.country ? ` · ${v.country}` : ''}` : (v.note || (v.ok ? 'OK' : 'başarısız'))}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {msg ? (
          <div className={`proxy-msg proxy-msg-${msg.kind}`}>
            {msg.kind === 'ok' ? <Check size={14} /> : msg.kind === 'err' ? <ShieldAlert size={14} /> : <Globe size={14} />}
            <span>{msg.text}</span>
          </div>
        ) : null}

        <footer className="modal-foot">
          <span className="helper">Proxy redsocks + iptables ile Waydroid instance'ına gömülür (uygulama içi ayar gerekmez).</span>
          {tab === 'country' ? (
            <button type="button" className="btn-primary" disabled={!providerId || !country || busy} onClick={assignCountry}>
              {busy ? <Loader2 size={14} className="spin" /> : <Network size={14} />} {country ? `${flag(country)} ${country} göm` : 'Ülke seçin'}
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={!savedSel || busy} onClick={assignSaved}>
              {busy ? <Loader2 size={14} className="spin" /> : <Network size={14} />} Proxy'yi göm
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
