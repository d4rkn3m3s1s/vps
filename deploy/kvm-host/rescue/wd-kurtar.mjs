#!/usr/bin/env node
// 2026-08-14 ACIL KURTARMA UCU (zero-dep Node, agent gibi).
//
// NEDEN VAR: 14 Agustos'ta sistem UC KEZ kilitlendi. Her seferinde:
//   - SSH girisi ACILMADI (PAM -> systemd-logind D-Bus cagrisi asili kaliyor)
//   - `systemctl` yanit vermedi
//   - AMA API/Caddy 200 dondu (zaten calisan surec, /proc'a dokunmuyor)
// Yani HTTP kanali hayatta kalan TEK kanaldi. Kurtarma bu kanaldan yapilir.
//
// TASARIM KURALI: hicbir eylem systemd'ye BAGIMLI OLMAYACAK.
//   `systemctl stop` tikaliyken asili kalir -> bunun yerine DOGRUDAN surec oldurme.
//   Durum bilgisi /proc dosyalarindan okunur (tarama YOK).
//
// GUVENLIK: token zorunlu + SADECE beyaz listedeki eylemler (serbest shell YOK).
//   Token: /opt/fleet-agent/state/kurtar.token  (0600)
//   Tum istekler /var/log/wd-kurtar.log'a yazilir.

import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4700;
const HOST = '127.0.0.1';               // disari Caddy uzerinden acilir
const TOKEN_FILE = '/opt/fleet-agent/state/kurtar.token';
const LOG = '/var/log/wd-kurtar.log';

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
}

function token() {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}

// --- kabuk yardimcisi: her cagri ZAMAN SINIRLI (asili kalmasin)
function sh(cmd, ms = 12000) {
  return new Promise((resolve) => {
    execFile('/bin/bash', ['-c', cmd], { timeout: ms, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => resolve({
        ok: !err,
        out: String(stdout || '').trim(),
        err: String(stderr || '').trim(),
        timedOut: !!(err && err.killed)
      }));
  });
}

// --- DURUM: sadece /proc okumalari (systemd'ye dokunmaz, tarama yok)
function procDurum() {
  const oku = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const stat = oku('/proc/stat');
  const dBlocked = (stat.match(/^procs_blocked\s+(\d+)/m) || [])[1] ?? '?';
  const running  = (stat.match(/^procs_running\s+(\d+)/m) || [])[1] ?? '?';
  const load = oku('/proc/loadavg').split(' ').slice(0, 3).join(' ');
  const up = Math.round(parseFloat(oku('/proc/uptime').split(' ')[0] || 0));
  const mi = oku('/proc/meminfo');
  const kb = (k) => parseInt((mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0, 10);
  return {
    dState: dBlocked,
    kosan: running,
    load,
    uptimeSn: up,
    ramBosGb: Math.round(kb('MemAvailable') / 1024 / 1024),
    ramToplamGb: Math.round(kb('MemTotal') / 1024 / 1024),
    swapKullanimPct: kb('SwapTotal') ? Math.round((kb('SwapTotal') - kb('SwapFree')) * 100 / kb('SwapTotal')) : 0
  };
}

// systemd yanit suresi -- ASIL sinyal. Tikaliysa 9999 doner.
async function systemdMs() {
  const t0 = Date.now();
  const r = await sh('systemctl is-system-running', 8000);
  return r.timedOut ? 9999 : (Date.now() - t0);
}

// ---------------------------------------------------------------------------
// BEYAZ LISTE. Serbest komut YOK. Hepsi systemd'den BAGIMSIZ calisir.
// ---------------------------------------------------------------------------
const EYLEMLER = {
  // Tikanmanin en sik kaynagi: benim acilis betiklerim. Once bunlari kes.
  'durdur-betikler': {
    aciklama: 'Acilis/onarim betiklerini DOGRUDAN oldurur (systemd gerekmez)',
    cmd: "pkill -f 'wd-cozul\\.sh|wd-kademeli\\.sh|wd-onar\\.sh|wd-adb-tara\\.sh|wd-boot-toparla\\.sh' ; echo kesildi"
  },
  // Takili boot-gate kapilari (her biri bekleme dongusunde)
  'durdur-kapilar': {
    aciklama: 'Bekleyen wd-boot-gate kapilarini serbest birakir',
    cmd: "pkill -f 'wd-boot-gate\\.sh' ; echo kesildi"
  },
  'durdur-agent': {
    aciklama: 'fleet-agent surecini oldurur',
    cmd: "pkill -f '/opt/agent\\.mjs' ; echo kesildi"
  },
  'baslat-agent': {
    aciklama: 'fleet-agent servisini baslatir (systemd gerekir)',
    cmd: 'timeout 15 systemctl start fleet-agent && echo baslatildi'
  },
  // ★2026-08-14: PANELDEN tek tik. Canli yayin kanali (agent -> /ws/agent-stream)
  // API restart'inda veya ag kesintisinde kopuyor ve kendiliginden donmeyebiliyor;
  // tek care `systemctl restart fleet-agent` idi ama operator SSH acamayabiliyor.
  // Once nazik restart denenir; systemd tikaliysa pkill + start ile zorlanir.
  'sifirla-agent': {
    aciklama: 'Agent + canli yayin kanalini sifirlar (panel butonu bunu cagirir)',
    cmd:
      'if timeout 20 systemctl restart fleet-agent 2>/dev/null; then echo "restart-ok"; ' +
      'else pkill -f "/opt/agent\\.mjs" 2>/dev/null; sleep 2; ' +
      'timeout 20 systemctl start fleet-agent 2>/dev/null && echo "pkill+start-ok" || echo "BASARISIZ"; fi'
  },
  // Her seyi kes -- sistem nefes alsin. CIHAZLARI KAPATMAZ.
  'panik': {
    aciklama: 'TUM fleet betikleri + agent durur. Cihazlar KAPANMAZ.',
    cmd: "pkill -f 'wd-cozul\\.sh|wd-kademeli\\.sh|wd-onar\\.sh|wd-adb-tara\\.sh|wd-boot-toparla\\.sh|wd-boot-gate\\.sh' ; pkill -f '/opt/agent\\.mjs' ; echo panik-uygulandi"
  },
  'log-fren': {
    aciklama: 'Fren kaydinin son satirlari',
    cmd: 'tail -12 /var/log/wd-fren.log 2>/dev/null || echo yok'
  },
  'log-izle': {
    aciklama: 'Durum kaydinin son satirlari',
    cmd: 'tail -12 /var/log/wd-izle.log 2>/dev/null || echo yok'
  },
  'log-watchdog': {
    aciklama: 'Watchdog kaydi',
    cmd: 'tail -12 /var/log/wd-watchdog.log 2>/dev/null || echo yok'
  },
  // SON CARE: systemd tamamen tikaliyken bile calisir (cekirdek seviyesi).
  // Once disk senkronu, sonra sert yeniden baslatma.
  'reboot-zorla': {
    aciklama: 'SON CARE: sync + cekirdek seviyesi yeniden baslatma (sysrq)',
    cmd: "echo s > /proc/sysrq-trigger; sleep 3; echo u > /proc/sysrq-trigger; sleep 2; echo b > /proc/sysrq-trigger",
    tehlikeli: true
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const yol = url.pathname.replace(/^\/kurtar/, '') || '/';
  const gonder = (kod, obj) => {
    res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };

  // --- kimlik: token zorunlu (header veya query)
  const bekleniyor = token();
  const geldi = req.headers['x-kurtar-token'] || url.searchParams.get('token') || '';
  if (!bekleniyor) { log(`RET token-dosyasi-yok ${yol}`); return gonder(503, { hata: 'token dosyasi yok' }); }
  if (geldi !== bekleniyor) {
    log(`RET yetkisiz ${yol} ip=${req.socket.remoteAddress}`);
    return gonder(401, { hata: 'yetkisiz' });
  }

  if (yol === '/' || yol === '/durum') {
    const d = procDurum();
    const ms = await systemdMs();
    // ★2026-08-15: GERCEK calisan container sayisi.
    // Eskiden systemd sayimi kullaniliyordu ve YANILTICIYDI: health-watch zombie
    // cihazlari `wd-run.sh` ile DOGRUDAN yeniden baslatiyor, wd-provision da yeni
    // cihazi systemd disinda aciyor -> unit "running" gorunmuyor ama container
    // AYAKTA. Canli: systemd=126 derken ADB=156 idi (imkansiz bir oran; operator
    // fark etti). Olcum artik bridge'in uye arayuzu uzerinden: sadece /sys,
    // /proc TARAMASI YOK (bkz. README -- taramanin kendisi sistemi kilitliyordu).
    const acik = await sh(
      "n=0; for d in /sys/class/net/waydroid-*/brif; do " +
        '[ -n "$(ls -A "$d" 2>/dev/null)" ] || continue; ' +
        'i=${d#/sys/class/net/waydroid-}; i=${i%/brif}; ' +
        'grep -qxF "$i" /opt/fleet-agent/state/instance-haric.txt 2>/dev/null && continue; ' +
        'n=$((n+1)); done; echo "$n"',
      10000
    );
    const sysd = await sh("timeout 8 systemctl list-units --state=running 'waydroid@*' 2>/dev/null | grep -c waydroid@", 10000);
    const toplam = await sh('wc -l < /opt/fleet-agent/state/all_inst.txt 2>/dev/null', 6000);
    const adb = await sh("timeout 8 adb devices 2>/dev/null | grep -c 'device$'", 10000);
    log(`OK durum d=${d.dState} sd=${ms}`);
    return gonder(200, {
      ...d,
      systemdMs: ms,
      systemdSaglikli: ms <= 5000,
      acikCihaz: acik.ok ? acik.out : '?',      // GERCEK container (bridge uyesi)
      toplamCihaz: toplam.ok ? toplam.out.trim() : '?',
      systemdSayimi: sysd.ok ? sysd.out : '?',  // yaniltici olabilir -- bilgi amacli
      adbBagli: adb.ok ? adb.out : '?',
      eylemler: Object.fromEntries(Object.entries(EYLEMLER).map(([k, v]) => [k, v.aciklama]))
    });
  }

  if (yol === '/eylem') {
    const ad = url.searchParams.get('ad') || '';
    const e = EYLEMLER[ad];
    if (!e) { log(`RET bilinmeyen-eylem ${ad}`); return gonder(400, { hata: 'bilinmeyen eylem', gecerli: Object.keys(EYLEMLER) }); }
    if (e.tehlikeli && url.searchParams.get('onay') !== 'evet') {
      return gonder(400, { hata: 'bu eylem tehlikeli', nasil: `?ad=${ad}&onay=evet` });
    }
    log(`EYLEM ${ad} basliyor`);
    const r = await sh(e.cmd, 30000);
    log(`EYLEM ${ad} bitti ok=${r.ok} out=${r.out.slice(0, 200)}`);
    return gonder(200, { eylem: ad, ok: r.ok, cikti: r.out, hata: r.err, zamanAsimi: r.timedOut });
  }

  return gonder(404, { hata: 'yok', yollar: ['/kurtar/durum', '/kurtar/eylem?ad=<eylem>'] });
});

server.listen(PORT, HOST, () => log(`kurtarma ucu dinliyor ${HOST}:${PORT}`));
