'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, Trash2, Check, MessageSquare, Hash, Plus } from 'lucide-react';

type ChannelType = 'telegram' | 'slack' | 'discord';

type Channel = {
  id: string;
  type: ChannelType;
  active: boolean;
  configured: true;
  lastTestedAt: string | null;
};

const CATALOG: { type: ChannelType; label: string; hint: string }[] = [
  { type: 'telegram', label: 'Telegram', hint: 'Bot token + chat ID' },
  { type: 'slack', label: 'Slack', hint: 'Incoming webhook URL' },
  { type: 'discord', label: 'Discord', hint: 'Webhook URL' }
];

function iconFor(type: ChannelType) {
  if (type === 'telegram') return <Send size={16} />;
  if (type === 'slack') return <Hash size={16} />;
  return <MessageSquare size={16} />;
}

export function NotificationChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editType, setEditType] = useState<ChannelType | null>(null);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/notifications/channels');
      const j = await r.json();
      setChannels(j.data ?? []);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byType = (t: ChannelType) => channels.find((c) => c.type === t);

  function openModal(type: ChannelType) {
    setEditType(type);
    setBotToken('');
    setChatId('');
    setWebhookUrl('');
    setModalErr('');
  }

  function closeModal() {
    setEditType(null);
    setModalErr('');
  }

  async function save() {
    if (!editType) return;
    const config =
      editType === 'telegram'
        ? { botToken: botToken.trim(), chatId: chatId.trim() }
        : { webhookUrl: webhookUrl.trim() };
    setSaving(true);
    setModalErr('');
    try {
      const r = await fetch('/api/notifications/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: editType, config })
      });
      if (!r.ok) {
        setModalErr('Kaydedilemedi. Bilgileri kontrol edin.');
        return;
      }
      closeModal();
      void load();
    } catch {
      setModalErr('Bir hata oluştu.');
    } finally {
      setSaving(false);
    }
  }

  async function testChannel(id: string) {
    setStatus(null);
    try {
      const r = await fetch(`/api/notifications/channels/${id}/test`, { method: 'POST' });
      const j = await r.json();
      const ok = !!j.data?.ok;
      setStatus({
        id,
        ok,
        msg: ok ? 'Test mesajı gönderildi.' : `Başarısız: ${j.data?.error ?? 'bilinmeyen hata'}`
      });
    } catch {
      setStatus({ id, ok: false, msg: 'Test gönderilemedi.' });
    }
  }

  async function remove(id: string) {
    await fetch(`/api/notifications/channels/${id}`, { method: 'DELETE' });
    void load();
  }

  return (
    <div className="panel-stack">
      {loading ? (
        <>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </>
      ) : (
        CATALOG.map((c) => {
          const ch = byType(c.type);
          return (
            <div className="row alert-rule-row" key={c.type}>
              <div>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {iconFor(c.type)} {c.label}
                </strong>
                <div className="helper mono">
                  {ch ? (
                    <span className="status-chip pill-on">
                      <Check size={12} /> Yapılandırıldı
                    </span>
                  ) : (
                    c.hint
                  )}
                </div>
                {ch && status?.id === ch.id ? (
                  <div className={`form-status ${status.ok ? 'form-status--ok' : 'form-status--err'}`} role="status">
                    {status.msg}
                  </div>
                ) : null}
              </div>
              <div className="alert-rule-actions">
                {ch ? (
                  <button type="button" className="status-chip btn-xs" onClick={() => testChannel(ch.id)}>
                    <Send size={12} /> Test
                  </button>
                ) : null}
                <button type="button" className="btn-ghost btn-xs" onClick={() => openModal(c.type)}>
                  {ch ? 'Düzenle' : (<><Plus size={13} /> Ekle</>)}
                </button>
                {ch ? (
                  <button type="button" className="btn-ghost btn-xs" onClick={() => remove(ch.id)} aria-label="Sil">
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {editType ? (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {iconFor(editType)} {CATALOG.find((c) => c.type === editType)?.label} kanalı
            </h3>
            {editType === 'telegram' ? (
              <>
                <div className="field">
                  <label className="field-label">Bot Token</label>
                  <input
                    className="field-input"
                    type="password"
                    placeholder="123456:ABC-DEF..."
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Chat ID</label>
                  <input
                    className="field-input"
                    placeholder="-100123456789"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="field">
                <label className="field-label">Webhook URL</label>
                <input
                  className="field-input"
                  type="password"
                  placeholder="https://..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
            )}
            {modalErr ? (
              <div className="form-status form-status--err" role="alert">{modalErr}</div>
            ) : null}
            <p className="helper">Gizli bilgiler şifrelenerek saklanır ve bir daha gösterilmez.</p>
            <div className="alert-rule-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={closeModal}>İptal</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>
                Kaydet
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
