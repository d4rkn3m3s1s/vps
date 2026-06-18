'use client';

import { useState } from 'react';

const AIGC = [
  { title: 'Image to Video', desc: 'Generate short videos from a single image.', prompt: 'Help me plan an image-to-video generation: what tools and steps should I use to turn a product image into a short promotional video for my cloud phones?' },
  { title: 'Text to Video', desc: 'Turn a prompt into a ready-to-post video.', prompt: 'Write me a short, punchy script and shot list for a text-to-video ad. Topic: ' },
  { title: 'Generate Image', desc: 'Create on-brand images for your posts.', prompt: 'Suggest on-brand image prompts (with style, colors, composition) I can use to generate social media graphics for: ' }
];

const AUTOMATION = [
  { title: 'TikTok video posting', icon: 'TT', color: '#111', prompt: 'Outline an RPA automation flow to post a video to TikTok from a cloud phone — step by step (open app, upload, caption, hashtags, publish).' },
  { title: 'TikTok carousel posting', icon: 'TT', color: '#111', prompt: 'Outline an RPA automation flow to post a photo carousel to TikTok from a cloud phone, step by step.' },
  { title: 'Post content on Facebook', icon: 'FB', color: '#1877f2', prompt: 'Outline an RPA automation flow to publish a post to Facebook from a cloud phone, step by step.' },
  { title: 'Publish YouTube Shorts', icon: 'YT', color: '#ff0000', prompt: 'Outline an RPA automation flow to upload a YouTube Short from a cloud phone, step by step.' },
  { title: 'Post Reels on Instagram', icon: 'IG', color: '#d6249f', prompt: 'Outline an RPA automation flow to post an Instagram Reel from a cloud phone, step by step.' },
  { title: 'Publish video on Reddit', icon: 'R', color: '#ff4500', prompt: 'Outline an RPA automation flow to publish a video to a subreddit from a cloud phone, step by step.' }
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
          <h3 className="section-label">⚡ AI automation</h3>
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
          <h3 className="section-label">✦ Ask AI</h3>
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
