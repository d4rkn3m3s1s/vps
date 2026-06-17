'use client';

import { useState } from 'react';
import { Button } from '@heroui/react';

const AIGC = [
  { title: 'Image to Video', desc: 'Generate short videos from a single image.' },
  { title: 'Text to Video', desc: 'Turn a prompt into a ready-to-post video.' },
  { title: 'Generate Image', desc: 'Create on-brand images for your posts.' }
];

const AUTOMATION = [
  { title: 'TikTok video posting', icon: 'TT', color: '#111' },
  { title: 'TikTok carousel posting', icon: 'TT', color: '#111' },
  { title: 'Post content on Facebook', icon: 'FB', color: '#1877f2' },
  { title: 'Publish YouTube Shorts', icon: 'YT', color: '#ff0000' },
  { title: 'Post Reels on Instagram', icon: 'IG', color: '#d6249f' },
  { title: 'Publish video on Reddit', icon: 'R', color: '#ff4500' }
];

const ASK = ['How does billing work?', 'How to use RPA?', 'How to configure a proxy?', 'How to choose a plan?'];

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
      if (!res.ok) throw new Error(json.error ?? 'AI request failed.');
      setMessages((m) => [...m, { role: 'assistant', text: json.data.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed.');
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
          <h1>What can I do for you today?</h1>
        </div>
      ) : (
        <div className="ai-thread">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'ai-msg ai-msg-user' : 'ai-msg ai-msg-assistant'}>
              {m.text}
            </div>
          ))}
          {busy ? <div className="ai-msg ai-msg-assistant helper">Fleet AI is thinking…</div> : null}
        </div>
      )}

      <div className="ai-input-card">
        <textarea
          className="ai-input"
          placeholder="Ask Fleet AI…"
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
            <Button type="button" className="ai-send" isDisabled={Boolean(prompt.trim().length === 0 || busy)} onPress={send}>
              ➤
            </Button>
          </div>
        </div>
      </div>

      <div className="ai-columns">
        <section>
          <h3 className="section-label">✶ AIGC</h3>
          <div className="ai-stack">
            {AIGC.map((item) => (
              <Button type="button" className="ai-card" key={item.title}>
                <strong>{item.title}</strong>
                <span className="helper">{item.desc}</span>
              </Button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="section-label">⚡ AI automation</h3>
          <div className="ai-stack">
            {AUTOMATION.map((item) => (
              <Button type="button" className="ai-row" key={item.title}>
                <span className="tpl-badge" style={{ background: item.color }}>
                  {item.icon}
                </span>
                {item.title}
              </Button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="section-label">✦ Ask AI</h3>
          <div className="ai-stack">
            {ASK.map((q) => (
              <Button type="button" className="ai-row" key={q} isDisabled={Boolean(busy)} onPress={() => { setPrompt(q); }}>
                {q}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
