'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';

type Ws = { id: string; name: string; slug: string; role: string };

// Real, guarded destructive actions for the active workspace. Both require the
// admin to type the workspace SLUG to confirm, and both call real API endpoints
// (POST /workspaces/:id/reset, DELETE /workspaces/:id). Non-admins see a notice.
export function DangerZone() {
  const router = useRouter();
  const [ws, setWs] = useState<Ws | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'reset' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspaces', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const list: Ws[] = json?.data ?? [];
        // Prefer the active workspace cookie; fall back to the first admin one.
        const cookie = document.cookie.split('; ').find((c) => c.startsWith('fleet_workspace='))?.split('=')[1];
        const active = list.find((w) => w.id === cookie) ?? list.find((w) => w.role === 'admin') ?? list[0] ?? null;
        setWs(active);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const isAdmin = ws?.role === 'admin';
  const confirmed = ws ? confirm.trim().toLowerCase() === ws.slug.toLowerCase() : false;

  async function run() {
    if (!ws || !mode || !confirmed) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = mode === 'reset'
        ? await fetch(`/api/workspaces/${ws.id}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }) })
        : await fetch(`/api/workspaces/${ws.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.data?.message ?? json?.message ?? 'İşlem başarısız');
      setMsg({ kind: 'ok', text: mode === 'reset' ? 'Çalışma alanı verileri sıfırlandı.' : 'Çalışma alanı silindi.' });
      setMode(null); setConfirm('');
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'İşlem başarısız' });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="helper"><Loader2 size={13} className="spin" /> Yükleniyor…</p>;
  if (!ws) return <p className="helper">Çalışma alanı bulunamadı.</p>;
  if (!isAdmin) return <p className="helper">Bu işlemler yalnızca çalışma alanı yöneticileri içindir.</p>;

  return (
    <div>
      <p className="helper">Bu işlemler geri alınamaz. <strong>{ws.name}</strong> ({ws.slug}) için geçerlidir.</p>
      {msg && <div className={`toast toast-${msg.kind === 'ok' ? 'ok' : 'err'}`} style={{ position: 'static', marginTop: 8 }}>{msg.text}</div>}

      {!mode ? (
        <div className="quick-grid" style={{ marginTop: 12 }}>
          <button type="button" className="btn-ghost danger-btn" onClick={() => { setMode('reset'); setConfirm(''); setMsg(null); }}>
            Çalışma alanı verilerini sıfırla
          </button>
          <button type="button" className="btn-ghost danger-btn" onClick={() => { setMode('delete'); setConfirm(''); setMsg(null); }}>
            Çalışma alanını sil
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="helper" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} style={{ color: 'var(--accent)' }} />
            {mode === 'reset'
              ? 'TÜM cihazlar, proxyler, hesaplar, işler, RPA akışları ve uyarılar SİLİNECEK (üyeler ve ayarlar kalır).'
              : 'Çalışma alanı ve içindeki HER ŞEY kalıcı olarak silinecek.'}
          </p>
          <label className="field">
            <span>Onaylamak için çalışma alanı adını yazın: <code>{ws.slug}</code></span>
            <input className="field-input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={ws.slug} autoFocus />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => { setMode(null); setConfirm(''); }} disabled={busy}>İptal</button>
            <button type="button" className="btn-ghost danger-btn" disabled={!confirmed || busy} onClick={run}>
              {busy ? 'İşleniyor…' : mode === 'reset' ? 'Verileri sıfırla' : 'Kalıcı olarak sil'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
