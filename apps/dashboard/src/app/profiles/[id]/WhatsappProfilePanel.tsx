'use client';

import { useState, useRef } from 'react';
import { UserCog, Image as ImageIcon, Type } from 'lucide-react';

// Change the device's OWN WhatsApp profile — display name + picture. Each action
// queues a host-agent job (WHATSAPP_SET_NAME / WHATSAPP_SET_AVATAR); the result
// lands in the device's job history. The picture is read client-side into a base64
// data payload and posted to the API, which pushes it to the device gallery and
// drives WhatsApp's SetAsProfilePhoto → crop → Done.
export function WhatsappProfilePanel({ deviceId }: { deviceId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setMsg({ text, kind });
    setTimeout(() => setMsg(null), 5000);
  }

  async function saveName() {
    const n = name.trim();
    if (!n) { flash('İsim girin.', 'err'); return; }
    if (n.length > 25) { flash('İsim en fazla 25 karakter.', 'err'); return; }
    setBusy('name');
    try {
      const res = await fetch('/api/accounts/whatsapp/profile/name', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, name: n })
      });
      if (!res.ok) throw new Error(`İşlem başarısız (${res.status})`);
      flash(`Profil ismi "${n}" olarak sıraya alındı — Görev geçmişinden izleyin.`);
      setName('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Hata', 'err');
    } finally { setBusy(null); }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) { flash('Sadece PNG/JPEG/WebP.', 'err'); return; }
    if (f.size > 8 * 1024 * 1024) { flash('Resim en fazla 8MB.', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result || '');
      setPreview(dataUri);
      setImageB64(dataUri.replace(/^data:[^,]+,/, '')); // strip data-URI prefix
    };
    reader.readAsDataURL(f);
  }

  async function saveAvatar() {
    if (!imageB64) { flash('Önce bir resim seçin.', 'err'); return; }
    setBusy('avatar');
    try {
      const res = await fetch('/api/accounts/whatsapp/profile/avatar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, imageB64 })
      });
      if (!res.ok) throw new Error(`İşlem başarısız (${res.status})`);
      flash('Profil resmi sıraya alındı — Görev geçmişinden izleyin.');
      setPreview(null); setImageB64(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Hata', 'err');
    } finally { setBusy(null); }
  }

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <UserCog size={16} /> WhatsApp profili
      </h2>
      <p className="helper">Cihazın kendi WhatsApp profil ismini ve resmini değiştirin.</p>
      {msg ? <p className="helper" style={{ color: msg.kind === 'err' ? 'var(--danger, #e5484d)' : 'var(--accent, #3ba55d)' }}>{msg.text}</p> : null}

      {/* İsim değiştir */}
      <div style={{ marginTop: '.75rem' }}>
        <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}><Type size={13} /> Profil ismi (maks 25)</label>
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '.35rem' }}>
          <input
            className="field-input"
            placeholder="Yeni isim…"
            value={name}
            maxLength={25}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" disabled={busy === 'name' || !name.trim()} onClick={saveName}>
            {busy === 'name' ? 'Sıraya alınıyor…' : 'İsmi kaydet'}
          </button>
        </div>
      </div>

      {/* Resim değiştir */}
      <div style={{ marginTop: '1rem' }}>
        <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}><ImageIcon size={13} /> Profil resmi (PNG/JPEG, kare önerilir)</label>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.35rem', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} className="field-input" style={{ flex: 1, minWidth: '12rem' }} />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="önizleme" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border, #333)' }} />
          ) : null}
          <button className="btn" disabled={busy === 'avatar' || !imageB64} onClick={saveAvatar}>
            {busy === 'avatar' ? 'Sıraya alınıyor…' : 'Resmi kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
