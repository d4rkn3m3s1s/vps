'use client';

import { useState } from 'react';
import { Upload, Download, ClipboardCopy, ClipboardPaste } from 'lucide-react';

// Per-device file transfer (push a URL to the gallery/downloads, pull a path off
// the device) and clipboard sync (set text, queue a read). Each action queues a
// host-agent job; results land in the device's job history.
export function FileClipboardPanel({ deviceId }: { deviceId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pushUrl, setPushUrl] = useState('');
  const [pushDest, setPushDest] = useState<'gallery' | 'downloads'>('gallery');
  const [pullPath, setPullPath] = useState('/sdcard/Download/');
  const [clip, setClip] = useState('');

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!res.ok) throw new Error(`İşlem başarısız (${res.status})`);
      flash(`${label} sıraya alındı — Görev geçmişinde sonucu görün.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Hata');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2>Dosya & pano</h2>
      {msg ? <p className="helper">{msg}</p> : null}

      {/* Push a file (by URL) to the device */}
      <div className="fc-row">
        <input className="field-input" placeholder="https://… dosya URL'si" value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} />
        <select className="inline-select" value={pushDest} onChange={(e) => setPushDest(e.target.value as 'gallery' | 'downloads')}>
          <option value="gallery">Galeri</option>
          <option value="downloads">İndirilenler</option>
        </select>
        <button type="button" className="btn-primary" disabled={!!busy || !pushUrl.trim()}
          onClick={() => call('Dosya gönderimi', '/api/files/push', { deviceIds: [deviceId], url: pushUrl.trim(), destination: pushDest })}>
          <Upload size={14} /> Gönder
        </button>
      </div>

      {/* Pull a file off the device */}
      <div className="fc-row">
        <input className="field-input" placeholder="/sdcard/Download/dosya.jpg" value={pullPath} onChange={(e) => setPullPath(e.target.value)} />
        <button type="button" className="btn-ghost" disabled={!!busy || !pullPath.trim()}
          onClick={() => call('Dosya çekme', `/api/devices/${deviceId}/pull-file`, { remotePath: pullPath.trim() })}>
          <Download size={14} /> Çek
        </button>
      </div>

      {/* Clipboard sync */}
      <div className="fc-row">
        <input className="field-input" placeholder="Cihaz panosuna yazılacak metin" value={clip} onChange={(e) => setClip(e.target.value)} />
        <button type="button" className="btn-ghost" disabled={!!busy || !clip.trim()}
          onClick={() => call('Pano yazma', `/api/devices/${deviceId}/clipboard`, { text: clip })}>
          <ClipboardPaste size={14} /> Panoya yaz
        </button>
        <button type="button" className="btn-ghost" disabled={!!busy}
          onClick={() => call('Pano okuma', `/api/devices/${deviceId}/clipboard/read`)}>
          <ClipboardCopy size={14} /> Panoyu oku
        </button>
      </div>
      <p className="helper" style={{ marginTop: '0.5rem' }}>Tüm işlemler host-agent görevleri olarak çalışır; çekilen dosyalar ve pano içeriği görev sonucunda görünür.</p>
    </div>
  );
}
