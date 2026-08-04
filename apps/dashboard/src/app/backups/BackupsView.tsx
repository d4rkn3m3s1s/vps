'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, CheckCircle2, Clock, Database, Download, HardDrive,
  Loader2, Play, Trash2, XCircle,
} from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import { useConfirm } from '../../components/ConfirmDialog';

type BackupFile = { name: string; sizeBytes: number; createdAt: string };
type DiskInfo = { totalBytes: number; freeBytes: number } | null;
type Status = {
  state: 'idle' | 'running' | 'success' | 'failed';
  startedAt: number | null;
  finishedAt: number | null;
  log: string[];
  phase: string;
  error: string | null;
  archive: string | null;
  keepCount: number;
};

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function humanDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sn`;
  return `${Math.floor(s / 60)} dk ${s % 60} sn`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function BackupsView() {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [disk, setDisk] = useState<DiskInfo>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const logRef = useRef<HTMLPreElement>(null);
  // Çalışan yedeğin durumunu yoklarken bittiği anda listeyi bir kez tazelemek
  // için önceki durumu tutuyoruz (her turda listeyi çekmek gereksiz yük olurdu).
  const prevState = useRef<Status['state'] | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch('/api/backups', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Liste alınamadı (${res.status})`);
      const json = await res.json();
      setFiles(Array.isArray(json.data?.files) ? json.data.files : []);
      setDisk(json.data?.disk ?? null);
      setStatus(json.data?.status ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // Yedek çalışırken durumu saniyede bir yokla; bitince listeyi bir kez tazele.
  useEffect(() => {
    if (status?.state !== 'running') {
      prevState.current = status?.state ?? null;
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/backups/status', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const next: Status | null = json.data ?? null;
        setStatus(next);
        if (next && next.state !== 'running' && prevState.current === 'running') {
          prevState.current = next.state;
          void loadAll();
        } else if (next) {
          prevState.current = next.state;
        }
      } catch {
        // geçici ağ hatası — bir sonraki turda yeniden dener
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status?.state, loadAll]);

  // Yeni satır geldikçe günlüğü en alta kaydır.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status?.log.length]);

  async function startBackup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/backups', { method: 'POST' });
      if (res.status === 409) throw new Error('Zaten bir yedekleme çalışıyor.');
      if (!res.ok) throw new Error(`Yedekleme başlatılamadı (${res.status})`);
      const json = await res.json();
      setStatus(json.data ?? null);
      prevState.current = 'running';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download(file: BackupFile) {
    setError(null);
    try {
      // İki adım: önce kısa ömürlü imzalı bağlantı, sonra tarayıcı dosyayı
      // DOĞRUDAN API'den çeker (büyük dosya panelden geçmez).
      const res = await fetch(`/api/backups/${encodeURIComponent(file.name)}/link`, { method: 'POST' });
      if (!res.ok) throw new Error(`İndirme bağlantısı alınamadı (${res.status})`);
      const json = await res.json();
      const url = json.data?.url;
      if (!url) throw new Error('İndirme bağlantısı boş döndü');
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(file: BackupFile) {
    const ok = await confirm({
      title: 'Yedeği sil',
      body: `"${file.name}" (${humanSize(file.sizeBytes)}) silinecek.`,
      warning: 'Bu işlem geri alınamaz. Arşiv, sha256 özeti ve açık dizini birlikte silinir.',
      confirmLabel: 'Sil',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Silinemedi (${res.status})`);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const running = status?.state === 'running';
  const newest = files[0];
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  return (
    <PageMotion className="page">
      {dialog}
      <HoloHeader
        eyebrow="SİSTEM YEDEĞİ"
        title="Yedekler"
        subtitle="Veritabanı · kod · sırlar · systemd · ağ yapılandırması · canlı filo durumu"
        actions={
          <button type="button" className="btn-primary" onClick={startBackup} disabled={busy || running}>
            {running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {running ? 'Yedekleniyor…' : 'Yeni Yedek Al'}
          </button>
        }
      />

      {error ? (
        <Reveal>
          <div className="hud-note danger" role="alert" style={{ marginBottom: 16 }}>
            <XCircle size={15} /> {error}
          </div>
        </Reveal>
      ) : null}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Yedek Sayısı"
            value={<span className="mono">{files.length}</span>}
            sub={status ? `son ${status.keepCount} tanesi saklanır` : 'saklama sınırı'}
            tone="cyan"
            icon={<Archive size={16} />}
          />
          <HoloStat
            label="Son Yedek"
            value={<span className="mono">{newest ? formatDate(newest.createdAt) : '—'}</span>}
            sub={newest ? humanSize(newest.sizeBytes) : 'henüz yedek yok'}
            tone={newest ? 'cyan' : 'violet'}
            icon={<Clock size={16} />}
          />
          <HoloStat
            label="Toplam Boyut"
            value={<span className="mono">{humanSize(totalBytes)}</span>}
            sub="tüm yedekler"
            tone="violet"
            icon={<Database size={16} />}
          />
          <HoloStat
            label="Boş Disk"
            value={<span className="mono">{disk ? humanSize(disk.freeBytes) : '—'}</span>}
            sub={disk ? `toplam ${humanSize(disk.totalBytes)}` : 'ölçülemedi'}
            tone="cyan"
            icon={<HardDrive size={16} />}
          />
        </div>
      </Reveal>

      {status && status.state !== 'idle' ? (
        <Reveal delay={0.04}>
          <HoloPanel
            title={
              running ? `Yedekleme sürüyor · ${status.phase || 'hazırlanıyor'}`
                : status.state === 'success' ? 'Yedekleme tamamlandı'
                  : 'Yedekleme başarısız'
            }
            icon={
              running ? <Loader2 size={16} className="spin" />
                : status.state === 'success' ? <CheckCircle2 size={16} />
                  : <XCircle size={16} />
            }
            actions={
              status.startedAt ? (
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {humanDuration((status.finishedAt ?? Date.now()) - status.startedAt)}
                </span>
              ) : null
            }
          >
            {status.error ? (
              <div className="hud-note danger" style={{ marginBottom: 12 }}>
                <XCircle size={15} /> {status.error}
              </div>
            ) : null}
            {status.state === 'success' && status.archive ? (
              <div className="hud-note ok" style={{ marginBottom: 12 }}>
                <CheckCircle2 size={15} /> Arşiv hazır: <span className="mono">{status.archive}</span>
              </div>
            ) : null}
            <pre
              ref={logRef}
              className="mono"
              style={{
                maxHeight: 260, overflowY: 'auto', fontSize: 12, lineHeight: 1.6,
                background: 'rgba(0,0,0,.28)', borderRadius: 10, padding: '12px 14px',
                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {status.log.length ? status.log.join('\n') : 'Betik çıktısı bekleniyor…'}
            </pre>
          </HoloPanel>
        </Reveal>
      ) : null}

      <Reveal delay={0.08}>
        <HoloPanel title="Alınan Yedekler" icon={<Archive size={16} />}>
          {loading ? (
            <p className="muted">Yükleniyor…</p>
          ) : files.length === 0 ? (
            <p className="muted">
              Henüz yedek yok. “Yeni Yedek Al” ile başlatabilirsiniz — yaklaşık 1 dakika sürer.
            </p>
          ) : (
            <div className="profile-table-wrap">
              <table className="profile-table">
                <thead>
                  <tr>
                    <th>Dosya</th>
                    <th>Boyut</th>
                    <th>Tarih</th>
                    <th style={{ textAlign: 'right' }}>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.name}>
                      <td className="mono" style={{ wordBreak: 'break-all' }}>{f.name}</td>
                      <td className="mono">{humanSize(f.sizeBytes)}</td>
                      <td className="mono">{formatDate(f.createdAt)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn-ghost" onClick={() => download(f)}>
                          <Download size={14} /> İndir
                        </button>
                        <button
                          type="button"
                          className="btn-ghost danger"
                          onClick={() => remove(f)}
                          style={{ marginLeft: 6 }}
                        >
                          <Trash2 size={14} /> Sil
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
            Yedek; PostgreSQL, Redis, uygulama kodu, şifreli sırlar, systemd birimleri,
            iptables/ufw kuralları, Waydroid betikleri ve cihaz–hesap haritasını içerir.
            Waydroid cihaz imajları (48 × ~1,5 GB) <strong>kasıtlı olarak dışarıdadır</strong> —
            arşivdeki <span className="mono">GERI-YUKLEME.md</span> bunları yeniden kurmayı anlatır.
          </p>
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
