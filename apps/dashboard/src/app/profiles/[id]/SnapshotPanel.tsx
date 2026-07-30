'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, RefreshCw } from 'lucide-react';
import { useConfirm } from '../../../components/ConfirmDialog';

// Capture-a-snapshot + one-click reset controls for a single device. Sits on the
// device detail page; the captured image then appears in the Image market.
export function SnapshotPanel({ deviceId }: { deviceId: string }) {
  const router = useRouter();
  // Panel onay modalı (tarayıcı confirm() yerine); `dialog` en altta ağaca eklenir.
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [regenFp, setRegenFp] = useState(true);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function capture() {
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/device/${deviceId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined })
      });
      if (!res.ok) throw new Error('Anlık görüntü başlatılamadı');
      flash('Anlık görüntü yakalama sıraya alındı — İmaj Pazarı’nda görünecek.');
      setName('');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    // ★2026-07-30 Tarayıcı confirm() yerine panel modalı. Bu işlem VERİ SİLİYOR,
    // uyarının net ve görünür olması kritik.
    const ok = await confirm({
      title: 'Cihaz sıfırlansın mı?',
      body: 'Kullanıcı verileri (uygulama verileri, medya) temizlenecek.',
      warning: '⚠️ Cihazda KAYITLI BİR WHATSAPP HESABI varsa o hesap KAYBOLUR ve numara yeniden kayıt gerektirir. Önce hesabın yedeğini/durumunu kontrol edin.',
      confirmLabel: 'Cihazı sıfırla',
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/device/${deviceId}/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerateFingerprint: regenFp, wipeData: true })
      });
      if (!res.ok) throw new Error('Sıfırlama başarısız');
      flash(`Cihaz sıfırlama sıraya alındı${regenFp ? ' (yeni parmak izi atandı)' : ''}.`);
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>Anlık görüntü & sıfırlama</h2>
      {msg ? <p className="helper">{msg}</p> : null}
      <div className="snapshot-panel-row">
        <input className="field-input" placeholder="Anlık görüntü adı (opsiyonel)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn-primary" disabled={busy} onClick={capture}><Camera size={14} /> Anlık görüntü al</button>
      </div>
      <div className="snapshot-panel-row" style={{ marginTop: '0.6rem' }}>
        <label className="fp-check" style={{ flex: 1 }}>
          <input type="checkbox" checked={regenFp} onChange={(e) => setRegenFp(e.target.checked)} /> Sıfırlamada yeni parmak izi üret
        </label>
        <button type="button" className="btn-ghost" disabled={busy} onClick={reset}><RefreshCw size={14} /> Tek tıkla sıfırla</button>
      </div>
      <p className="helper" style={{ marginTop: '0.6rem' }}>Anlık görüntü cihazın /sdcard içeriğini yakalar; sıfırlama kullanıcı medyasını temizler ve isteğe bağlı olarak donanım kimliğini yeniler.</p>
      {confirmDialog}
    </div>
  );
}
