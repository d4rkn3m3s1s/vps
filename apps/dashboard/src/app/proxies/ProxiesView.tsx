'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Proxy = {
  id: string;
  label: string;
  type: string;
  host: string;
  port: number;
  group: string | null;
  isp: string | null;
  remarks: string | null;
  exportIp: string | null;
  status: string;
  lastCheckedAt: string | null;
};

function StatusDot({ status }: { status: string }) {
  const cls = status === 'OK' ? 'dot dot-online' : status === 'FAILED' ? 'dot dot-error' : 'dot dot-offline';
  const label = status === 'OK' ? 'Çalışıyor' : status === 'FAILED' ? 'Başarısız' : 'Denetlenmedi';
  return (
    <span className="status-chip">
      <span className={cls} />
      {label}
    </span>
  );
}

export function ProxiesView({ proxies }: { proxies: Proxy[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'list' | 'config'>('list');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importType, setImportType] = useState('HTTP');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', type: 'HTTP', host: '', port: '8080', username: '', password: '', group: '' });

  // Default proxy mode for newly-created phones. Persisted as a real workspace
  // preference in localStorage and read back when the proxy form opens.
  const [proxyMode, setProxyMode] = useState('direct');
  const [savedMode, setSavedMode] = useState(false);
  useEffect(() => {
    try {
      const m = localStorage.getItem('fleet.defaultProxyMode');
      if (m) setProxyMode(m);
    } catch {
      /* ignore */
    }
  }, []);
  function saveProxyMode() {
    try {
      localStorage.setItem('fleet.defaultProxyMode', proxyMode);
      setSavedMode(true);
      setTimeout(() => setSavedMode(false), 2500);
    } catch {
      /* ignore */
    }
  }

  async function addProxy() {
    if (!form.label.trim() || !form.host.trim() || !form.port) {
      setError('Etiket, sunucu ve port zorunludur.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          type: form.type,
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username || undefined,
          password: form.password || undefined,
          group: form.group || undefined
        })
      });
      if (!res.ok) throw new Error(`Ekleme başarısız (${res.status})`);
      setAddOpen(false);
      setForm({ label: '', type: 'HTTP', host: '', port: '8080', username: '', password: '', group: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ekleme başarısız');
    } finally {
      setBusy(false);
    }
  }

  // Bulk-import a pasted provider proxy list.
  async function importProxies() {
    if (!importText.trim()) { setError('Proxy listesi boş.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proxies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: importText, type: importType })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.data?.message ?? 'İçe aktarma başarısız');
      setImportOpen(false);
      setImportText('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İçe aktarma başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function checkProxy(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/proxies/${id}/check`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProxy(id: string) {
    if (!confirm('Bu proxy silinsin mi?')) return;
    setBusyId(id);
    try {
      await fetch(`/api/proxies/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Proxy'ler"
        subtitle="Bulut telefonlarınıza konut veya mobil proxy atayın."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setImportOpen(true)}>⇪ Liste içe aktar</button>
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>+ Proxy ekle</button>
          </>
        }
      />

      {importOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setImportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Proxy listesi içe aktar</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setImportOpen(false)}>✕</button>
            </header>
            <div className="modal-body">
              <p className="helper">Herhangi bir sağlayıcıdan listeyi yapıştırın. Her satır bir proxy:<br /><code>host:port</code>, <code>host:port:kullanıcı:şifre</code>, <code>kullanıcı:şifre@host:port</code> veya <code>socks5://...</code>. İsteğe bağlı ülke etiketi: <code>host:port,US</code></p>
              <label className="field">
                <span>Tür</span>
                <select className="field-input" value={importType} onChange={(e) => setImportType(e.target.value)}>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5</option>
                </select>
              </label>
              <label className="field">
                <span>Proxy listesi</span>
                <textarea className="field-input" rows={8} placeholder={'1.2.3.4:8080:user:pass,US\n5.6.7.8:1080'} value={importText} onChange={(e) => setImportText(e.target.value)} />
              </label>
              {error ? <p className="field-error">{error}</p> : null}
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setImportOpen(false)} disabled={busy}>İptal</button>
              <button type="button" className="btn-primary" onClick={importProxies} disabled={busy}>{busy ? 'İçe aktarılıyor…' : 'İçe aktar'}</button>
            </footer>
          </div>
        </div>
      ) : null}

      <div className="tabs">
        <button type="button" className={tab === 'list' ? 'tab tab-active' : 'tab'} onClick={() => setTab('list')}>
          Proxy listesi
        </button>
        <button type="button" className={tab === 'config' ? 'tab tab-active' : 'tab'} onClick={() => setTab('config')}>
          Proxy yapılandırması
        </button>
      </div>

      {tab === 'list' ? (
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Etiket</th>
                <th>Tür</th>
                <th>Proxy bilgisi</th>
                <th>Dışa Çıkış IP</th>
                <th>Grup</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {proxies.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty">
                      <div className="empty-art">⌖</div>
                      <span>Şu anda veri yok</span>
                    </div>
                  </td>
                </tr>
              ) : (
                proxies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.label}</strong>
                    </td>
                    <td>{p.type}</td>
                    <td className="mono">
                      {p.host}:{p.port}
                    </td>
                    <td className="mono">{p.exportIp ?? '—'}</td>
                    <td>{p.group ?? 'Gruplanmamış'}</td>
                    <td>
                      <StatusDot status={p.status} />
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          type="button"
                          className="action-btn"
                          disabled={busyId === p.id}
                          onClick={() => checkProxy(p.id)}
                        >
                          {busyId === p.id ? '…' : 'Denetle'}
                        </button>
                        <button
                          type="button"
                          className="action-btn action-danger"
                          disabled={busyId === p.id}
                          onClick={() => deleteProxy(p.id)}
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="config-card">
          <h3>Varsayılan proxy modu</h3>
          <p className="helper">Yeni bulut telefonların internete nasıl bağlanacağını seçin.</p>
          <div className="radio-stack">
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'direct'} onChange={() => setProxyMode('direct')} /> Doğrudan (sunucu ağı)
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'residential'} onChange={() => setProxyMode('residential')} /> Konut proxy havuzu
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'mobile'} onChange={() => setProxyMode('mobile')} /> Mobil (4G/5G) proxy
            </label>
          </div>
          <button type="button" className="btn-primary" onClick={saveProxyMode}>
            {savedMode ? 'Kaydedildi ✓' : 'Yapılandırmayı kaydet'}
          </button>
        </div>
      )}

      {addOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setAddOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Proxy ekle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setAddOpen(false)}>
                ✕
              </button>
            </header>

            <label className="field">
              <span>Etiket</span>
              <input className="field-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="örn. ABD konut 1" />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Tür</span>
                <select className="field-input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5</option>
                </select>
              </label>
              <label className="field">
                <span>Grup</span>
                <input className="field-input" value={form.group} onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))} placeholder="isteğe bağlı" />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Sunucu</span>
                <input className="field-input" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="proxy.example.com" />
              </label>
              <label className="field">
                <span>Port</span>
                <input className="field-input" type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Kullanıcı adı</span>
                <input className="field-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="isteğe bağlı" />
              </label>
              <label className="field">
                <span>Parola</span>
                <input className="field-input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="isteğe bağlı" />
              </label>
            </div>

            {error ? <p className="field-error">{error}</p> : null}

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setAddOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={addProxy}>
                {busy ? 'Ekleniyor…' : 'Proxy ekle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
