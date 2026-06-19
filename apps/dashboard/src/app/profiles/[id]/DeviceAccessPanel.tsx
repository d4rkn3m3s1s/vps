'use client';

import { useEffect, useState } from 'react';
import { UserPlus, ShieldOff, ArrowRightLeft, Eye, MousePointerClick } from 'lucide-react';

type Grant = {
  id: string;
  access: 'VIEW' | 'CONTROL';
  granteeEmail: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
};

// Time-boxed device sharing + permanent transfer. Distinct from workspace ACLs:
// a grant lends one device to one teammate for a window, then auto-expires.
export function DeviceAccessPanel({ deviceId }: { deviceId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<'VIEW' | 'CONTROL'>('VIEW');
  const [hours, setHours] = useState('24');
  const [transferWs, setTransferWs] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function load() {
    try {
      const res = await fetch(`/api/grants/device/${deviceId}`);
      const json = await res.json();
      if (Array.isArray(json.data)) setGrants(json.data);
    } catch { /* ignore */ }
  }

  useEffect(() => { void load(); }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function issue() {
    if (!email.trim()) return flash('E-posta gerekli.');
    setBusy(true);
    try {
      const res = await fetch(`/api/grants/device/${deviceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), access, expiresInHours: hours ? Number(hours) : undefined })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Yetki verilemedi');
      flash('Erişim verildi.');
      setEmail('');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Yetki verilemedi');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/grants/${id}`, { method: 'DELETE' });
      flash('Erişim iptal edildi.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!transferWs.trim()) return flash('Hedef çalışma alanı gerekli.');
    if (!confirm('Cihaz kalıcı olarak başka bir çalışma alanına aktarılsın mı? Mevcut erişimler iptal edilecek.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/grants/device/${deviceId}/transfer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: transferWs.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Aktarım başarısız');
      flash(`Cihaz "${json.data?.workspaceName ?? 'hedef'}" alanına aktarıldı.`);
      setTransferWs('');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Aktarım başarısız');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>Erişim & devir</h2>
      {msg ? <p className="helper">{msg}</p> : null}

      <div className="grant-issue-row">
        <input className="field-input" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="inline-select" value={access} onChange={(e) => setAccess(e.target.value as 'VIEW' | 'CONTROL')}>
          <option value="VIEW">Görüntüleme</option>
          <option value="CONTROL">Kontrol</option>
        </select>
        <input className="field-input grant-hours" type="number" min={1} placeholder="saat" value={hours} onChange={(e) => setHours(e.target.value)} title="Süre (saat); boş = süresiz" />
        <button type="button" className="btn-primary" disabled={busy} onClick={issue}><UserPlus size={14} /> Erişim ver</button>
      </div>

      {grants.length > 0 ? (
        <div className="grant-list">
          {grants.map((g) => (
            <div key={g.id} className={`grant-row ${g.active ? '' : 'grant-inactive'}`}>
              <span className="grant-access">{g.access === 'CONTROL' ? <MousePointerClick size={13} /> : <Eye size={13} />}</span>
              <span className="grant-email">{g.granteeEmail ?? '—'}</span>
              <span className="helper grant-exp">
                {g.active ? (g.expiresAt ? `${new Date(g.expiresAt).toLocaleString('tr-TR')} sona erer` : 'süresiz') : 'pasif'}
              </span>
              {g.active ? (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => revoke(g.id)}><ShieldOff size={13} /> İptal</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : <p className="helper">Bu cihaz için verilmiş erişim yok.</p>}

      <div className="grant-transfer">
        <span className="helper"><ArrowRightLeft size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Kalıcı devir</span>
        <div className="grant-issue-row">
          <input className="field-input" placeholder="hedef çalışma alanı (slug veya id)" value={transferWs} onChange={(e) => setTransferWs(e.target.value)} />
          <button type="button" className="btn-ghost danger-btn" disabled={busy} onClick={transfer}>Devret</button>
        </div>
      </div>
    </div>
  );
}
