'use client';

import { useState } from 'react';

const AIGC = [
  { title: 'Görüntüden Videoya', desc: 'Tek bir görselden kısa videolar oluşturun.', prompt: 'Görüntüden videoya bir üretim planlamama yardım et: bir ürün görselini bulut telefonlarım için kısa bir tanıtım videosuna dönüştürmek için hangi araçları ve adımları kullanmalıyım?' },
  { title: 'Metinden Videoya', desc: 'Bir komutu yayına hazır videoya dönüştürün.', prompt: 'Metinden videoya bir reklam için kısa, etkili bir senaryo ve çekim listesi yaz. Konu: ' },
  { title: 'Görsel Oluştur', desc: 'Gönderileriniz için markaya uygun görseller oluşturun.', prompt: 'Şunun için sosyal medya grafikleri üretmek üzere kullanabileceğim markaya uygun görsel komutları (stil, renkler, kompozisyon ile) öner: ' }
];

const AUTOMATION = [
  { title: 'TikTok video paylaşımı', icon: 'TT', color: '#111', prompt: 'Bir bulut telefondan TikTok\'a video paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar (uygulamayı aç, yükle, açıklama, etiketler, yayınla).' },
  { title: 'TikTok carousel paylaşımı', icon: 'TT', color: '#111', prompt: 'Bir bulut telefondan TikTok\'a fotoğraf carousel\'i paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Facebook\'ta içerik paylaş', icon: 'FB', color: '#1877f2', prompt: 'Bir bulut telefondan Facebook\'ta bir gönderi yayınlamak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'YouTube Shorts yayınla', icon: 'YT', color: '#ff0000', prompt: 'Bir bulut telefondan YouTube Short yüklemek için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Instagram\'da Reels paylaş', icon: 'IG', color: '#d6249f', prompt: 'Bir bulut telefondan Instagram Reel paylaşmak için adım adım bir RPA otomasyon akışı taslağı çıkar.' },
  { title: 'Reddit\'te video yayınla', icon: 'R', color: '#ff4500', prompt: 'Bir bulut telefondan bir subreddit\'e video yayınlamak için adım adım bir RPA otomasyon akışı taslağı çıkar.' }
];

const ASK = ['Faturalandırma nasıl çalışır?', 'RPA nasıl kullanılır?', 'Proxy nasıl yapılandırılır?', 'Nasıl plan seçilir?'];

const MODELS = ['Claude Opus 4.8', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'];

type ChatMessage = { role: 'user' | 'assistant'; text: string };

export function AiView() {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(MODELS[0]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setPrompt('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, model })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'AI isteği başarısız oldu.');
      setMessages((m) => [...m, { role: 'assistant', text: json.data.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI isteği başarısız oldu.');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const hasChat = messages.length > 0;

  return (
    <main className="page ai-page">
      {!hasChat ? (
        <div className="ai-hero">
          <div className="ai-logo">✦</div>
          <h1>Bugün senin için ne yapabilirim?</h1>
        </div>
      ) : (
        <div className="ai-thread">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'ai-msg ai-msg-user' : 'ai-msg ai-msg-assistant'}>
              {m.text}
            </div>
          ))}
          {busy ? <div className="ai-msg ai-msg-assistant helper">Fleet AI düşünüyor…</div> : null}
        </div>
      )}

      <div className="ai-input-card">
        <textarea
          className="ai-input"
          placeholder="Fleet AI'ya sorun…"
          maxLength={2000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {error ? <p className="field-error">{error}</p> : null}
        <div className="ai-input-foot">
          <select className="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <div className="ai-foot-right">
            <span className="helper mono">{prompt.length} / 2000</span>
            <button type="button" className="ai-send" disabled={prompt.trim().length === 0 || busy} onClick={send}>
              ➤
            </button>
          </div>
        </div>
      </div>

      <div className="ai-columns">
        <section>
          <h3 className="section-label">✶ AIGC</h3>
          <div className="ai-stack">
            {AIGC.map((item) => (
              <button type="button" className="ai-card" key={item.title} disabled={busy} onClick={() => setPrompt(item.prompt)}>
                <strong>{item.title}</strong>
                <span className="helper">{item.desc}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="section-label">⚡ AI otomasyonu</h3>
          <div className="ai-stack">
            {AUTOMATION.map((item) => (
              <button type="button" className="ai-row" key={item.title} disabled={busy} onClick={() => setPrompt(item.prompt)}>
                <span className="tpl-badge" style={{ background: item.color }}>
                  {item.icon}
                </span>
                {item.title}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="section-label">✦ AI'ya Sor</h3>
          <div className="ai-stack">
            {ASK.map((q) => (
              <button type="button" className="ai-row" key={q} disabled={busy} onClick={() => { setPrompt(q); }}>
                {q}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
