// Sistem yedeği: çalıştırma, ilerleme takibi ve indirme.
//
// Yedeği ALAN şey bu servis DEĞİL — iş `/opt/fleet-backup.sh` betiğinde
// (9 aşama: PostgreSQL + Redis + kod + sırlar + systemd + iptables + betikler +
// canlı durum + manifest). Burada yaptığımız: betiği çalıştırmak, çıktısını
// canlı yayınlamak ve biten arşivi indirilebilir kılmak.
//
// TASARIM NOTLARI
// - Yedek arşivi ~860 MB. Dosya ASLA belleğe alınmaz; indirme `createReadStream`
//   ile akıtılır ve `Range` destekler (kopan indirme baştan başlamaz).
// - İndirme jetonu HMAC ile imzalanır ve kısa ömürlüdür: tarayıcı dosyayı
//   doğrudan API'den çeker, panelin Next.js katmanından GEÇMEZ (859 MB'ı proxy'den
//   geçirmek bellek/timeout riskidir).
// - Aynı anda YALNIZCA BİR yedek çalışır (`running`). İkinci istek 409 alır;
//   iki `pg_dump`ın aynı anda koşması diski ve DB'yi gereksiz yorar.

import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

const BACKUP_SCRIPT = process.env.FLEET_BACKUP_SCRIPT ?? '/opt/fleet-backup.sh';
const BACKUP_DIR = process.env.FLEET_BACKUP_DIR ?? '/opt/backups';
// Kaç yedek saklanacak — bunun ÜSTÜ her başarılı yedekten sonra silinir.
const KEEP_COUNT = Number(process.env.FLEET_BACKUP_KEEP ?? 5);
// İndirme jetonu ömrü. Kısa: bağlantı paylaşılırsa/loglanırsa çabuk ölsün.
const DOWNLOAD_TTL_MS = 10 * 60_000;
// Canlı günlükte tutulan satır sayısı (bellek sınırı).
const MAX_LOG_LINES = 400;

export type BackupState = 'idle' | 'running' | 'success' | 'failed';

type RunState = {
  state: BackupState;
  startedAt: number | null;
  finishedAt: number | null;
  /** Betiğin canlı çıktısı (son MAX_LOG_LINES satır). */
  log: string[];
  /** Betiğin bildirdiği son aşama, ör. "3/9 Uygulama kodu". */
  phase: string;
  error: string | null;
  /** Biten yedeğin arşiv adı. */
  archive: string | null;
};

const run: RunState = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  log: [],
  phase: '',
  error: null,
  archive: null,
};

export type BackupFile = {
  name: string;
  sizeBytes: number;
  createdAt: string;
};

function pushLog(line: string): void {
  const trimmed = line.replace(/\r/g, '').trimEnd();
  if (!trimmed) return;
  run.log.push(trimmed);
  if (run.log.length > MAX_LOG_LINES) run.log.splice(0, run.log.length - MAX_LOG_LINES);
  // Betik aşamaları "[00:25:31] 3/9 Uygulama kodu..." biçiminde yazıyor.
  const m = trimmed.match(/\]\s*(\d\/\d\s+[^.]+)/);
  if (m?.[1]) run.phase = m[1].trim();
}

/**
 * Yedek dizinindeki arşivleri yeniden eskiye sıralar.
 * Yalnızca `.tar.gz` döner — açık dizinler ve `.sha256` yan dosyaları değil.
 */
export async function listBackups(): Promise<BackupFile[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(BACKUP_DIR);
  } catch {
    return []; // dizin henüz yok = hiç yedek alınmamış
  }
  const files: BackupFile[] = [];
  for (const name of entries) {
    if (!name.endsWith('.tar.gz')) continue;
    try {
      const st = await fsp.stat(path.join(BACKUP_DIR, name));
      if (!st.isFile()) continue;
      files.push({ name, sizeBytes: st.size, createdAt: st.mtime.toISOString() });
    } catch {
      // yarışta silinmiş olabilir — atla
    }
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return files;
}

/**
 * KEEP_COUNT üstündeki eski yedekleri (arşiv + .sha256 + açık dizin) siler.
 * Silinemeyen dosya yedeği BAŞARISIZ SAYDIRMAZ — sadece loglanır.
 */
async function pruneOldBackups(): Promise<string[]> {
  if (!Number.isFinite(KEEP_COUNT) || KEEP_COUNT <= 0) return [];
  const files = await listBackups();
  const doomed = files.slice(KEEP_COUNT);
  const removed: string[] = [];
  for (const f of doomed) {
    const base = f.name.replace(/\.tar\.gz$/, '');
    for (const target of [f.name, `${f.name}.sha256`, base]) {
      try {
        await fsp.rm(path.join(BACKUP_DIR, target), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[backup] eski yedek silinemedi: ${target} (${(err as Error).message})`);
      }
    }
    removed.push(f.name);
  }
  return removed;
}

export function getBackupStatus(): RunState & { keepCount: number } {
  return { ...run, log: [...run.log], keepCount: KEEP_COUNT };
}

export function isBackupRunning(): boolean {
  return run.state === 'running';
}

/**
 * Yedeği başlatır. Çağrı ANINDA döner — betik arka planda koşar, ilerleme
 * `getBackupStatus()` ile okunur.
 *
 * @throws betik yoksa veya zaten bir yedek koşuyorsa
 */
export async function startBackup(onEvent?: (s: RunState) => void): Promise<void> {
  if (run.state === 'running') {
    throw Object.assign(new Error('Zaten bir yedekleme çalışıyor'), { statusCode: 409 });
  }
  try {
    await fsp.access(BACKUP_SCRIPT, fs.constants.X_OK);
  } catch {
    throw Object.assign(
      new Error(`Yedekleme betiği bulunamadı veya çalıştırılabilir değil: ${BACKUP_SCRIPT}`),
      { statusCode: 500 },
    );
  }

  run.state = 'running';
  run.startedAt = Date.now();
  run.finishedAt = null;
  run.log = [];
  run.phase = 'başlatılıyor';
  run.error = null;
  run.archive = null;
  onEvent?.(getBackupStatus());

  // `sudo -n`: parola SORMAZ. Betik root ister (docker exec, /etc okuma);
  // sorulursa süreç sessizce asılı kalırdı, bu yüzden -n şart.
  const child = spawn('sudo', ['-n', 'bash', BACKUP_SCRIPT, BACKUP_DIR], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onChunk = (buf: Buffer): void => {
    for (const line of buf.toString('utf8').split('\n')) pushLog(line);
    onEvent?.(getBackupStatus());
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  child.on('error', (err) => {
    run.state = 'failed';
    run.error = err.message;
    run.finishedAt = Date.now();
    logger.error(`[backup] süreç başlatılamadı: ${err.message}`);
    onEvent?.(getBackupStatus());
  });

  child.on('close', (code) => {
    void (async () => {
      run.finishedAt = Date.now();
      if (code === 0) {
        // Betik dizin üretir; indirilebilir tek dosya için arşivi BİZ oluşturuyoruz.
        const archived = await archiveLatest().catch((err: Error) => {
          pushLog(`arşivleme hatası: ${err.message}`);
          return null;
        });
        if (archived) {
          run.archive = archived;
          run.state = 'success';
          pushLog(`arşiv hazır: ${archived}`);
          const removed = await pruneOldBackups();
          if (removed.length) pushLog(`eski yedek silindi: ${removed.join(', ')}`);
        } else {
          run.state = 'failed';
          run.error = 'Yedek alındı ama arşiv oluşturulamadı';
        }
      } else {
        run.state = 'failed';
        run.error = `Yedekleme betiği ${code} koduyla çıktı`;
        logger.error(`[backup] betik başarısız (exit ${code})`);
      }
      onEvent?.(getBackupStatus());
    })();
  });
}

/**
 * Betiğin ürettiği EN YENİ yedek dizinini tek `.tar.gz` dosyasına paketler ve
 * yanına `.sha256` yazar. Arşiv zaten varsa yeniden üretmez.
 */
async function archiveLatest(): Promise<string | null> {
  const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('fleet-')).map((e) => e.name);
  if (!dirs.length) return null;
  dirs.sort();
  const latest = dirs[dirs.length - 1]!;
  const archive = `${latest}.tar.gz`;

  try {
    await fsp.access(path.join(BACKUP_DIR, archive));
    return archive; // betik zaten paketlemiş
  } catch {
    // yok — paketle
  }

  await new Promise<void>((resolve, reject) => {
    const tar = spawn('sudo', ['-n', 'tar', 'czf', path.join(BACKUP_DIR, archive), '-C', BACKUP_DIR, latest]);
    tar.on('error', reject);
    tar.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar ${c} koduyla çıktı`))));
  });

  // Bütünlük özeti — indirilen dosya doğrulanabilsin.
  await new Promise<void>((resolve) => {
    const sh = spawn('sudo', ['-n', 'bash', '-c',
      `cd ${BACKUP_DIR} && sha256sum ${archive} > ${archive}.sha256`]);
    sh.on('error', () => resolve());   // özet üretilemezse yedek yine geçerli
    sh.on('close', () => resolve());
  });

  return archive;
}

// ── İndirme jetonu ───────────────────────────────────────────────────────────
// Tarayıcı dosyayı doğrudan API'den çeker. Yol parametresi kullanıcıdan geldiği
// için jeton, dosya adını DA imzalar: başka bir ada geçerli jeton üretilemez.

// Doğrulanmış yapılandırmadan okunur (`process.env` DEĞİL): config şeması bu
// alanın en az 32 karakter olduğunu açılışta garanti eder, dolayısıyla burada
// ayrıca "boş mu" kontrolüne gerek kalmaz.
function signingKey(): string {
  return env.jwtAccessSecret;
}

/**
 * Tarayıcının indirme için kullanacağı yol ön eki.
 *
 * `/backups` DEĞİL: ters vekil o ön eki panele iletir (panelde aynı adlı sayfa
 * var) ve indirme 404 alırdı — canlıda görüldü. `/api-download` yalnızca API'ye
 * gider ve panelde karşılığı yoktur.
 */
export const DOWNLOAD_PATH = '/api-download/backup';

export function createDownloadToken(fileName: string): string {
  const exp = Date.now() + DOWNLOAD_TTL_MS;
  const payload = `${fileName}:${exp}`;
  const sig = createHmac('sha256', signingKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

/**
 * Jetonu doğrular ve dosya adını döner. Geçersiz/süresi geçmişse `null`.
 * Karşılaştırma `timingSafeEqual` ile — imza tahmini zamanlamadan sızmasın.
 */
export function verifyDownloadToken(token: string): string | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  // Dosya adında ':' olmadığı için son iki alan exp ve sig'dir.
  const parts = decoded.split(':');
  if (parts.length < 3) return null;
  const sig = parts.pop()!;
  const exp = Number(parts.pop());
  const fileName = parts.join(':');
  if (!Number.isFinite(exp) || exp < Date.now()) return null;

  const expected = createHmac('sha256', signingKey()).update(`${fileName}:${exp}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return fileName;
}

/**
 * Dosya adını yedek dizini içindeki gerçek yola çevirir.
 *
 * GÜVENLİK: ad kullanıcıdan gelir. `basename` + dizin doğrulaması ile
 * `../../etc/passwd` gibi yol kaçışları engellenir (imzalı jeton olmadan
 * buraya gelinemese de, savunma katmanı tek noktaya bırakılmaz).
 */
export async function resolveBackupFile(fileName: string): Promise<{ fullPath: string; size: number } | null> {
  const safe = path.basename(fileName);
  if (safe !== fileName || !safe.endsWith('.tar.gz')) return null;
  const fullPath = path.resolve(BACKUP_DIR, safe);
  if (path.dirname(fullPath) !== path.resolve(BACKUP_DIR)) return null;
  try {
    const st = await fsp.stat(fullPath);
    if (!st.isFile()) return null;
    return { fullPath, size: st.size };
  } catch {
    return null;
  }
}

export async function deleteBackup(fileName: string): Promise<boolean> {
  const found = await resolveBackupFile(fileName);
  if (!found) return false;
  const base = fileName.replace(/\.tar\.gz$/, '');
  for (const target of [fileName, `${fileName}.sha256`, base]) {
    try {
      await fsp.rm(path.resolve(BACKUP_DIR, path.basename(target)), { recursive: true, force: true });
    } catch (err) {
      logger.warn(`[backup] silinemedi: ${target} (${(err as Error).message})`);
    }
  }
  return true;
}

/** Yedek diskinin doluluk durumu — panelde "yer kalmadı" sürprizini önler. */
export async function getDiskInfo(): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    const st = await fsp.statfs(BACKUP_DIR);
    return { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    return null;
  }
}
