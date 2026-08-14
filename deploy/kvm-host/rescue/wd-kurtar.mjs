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

// ── Tarayici icin TIKLANABILIR kurtarma sayfasi ──────────────────────────────
// Acil durumda operator URL yazamaz; her eylem tek dokunusla erisilebilir olmali.
// Token zaten sayfayi acmak icin verildi, baglantilara gomulur.
function durumSayfasi(o, token) {
  const t = encodeURIComponent(token);
  const saglikli = o.systemdSaglikli === true;
  const renk = (kotu) => (kotu ? '#e74c3c' : '#2ecc71');
  const kart = (baslik, deger, alt, c) =>
    `<div class="c"><div class="k">${baslik}</div><div class="v"${c ? ` style="color:${c}"` : ''}>${deger}</div><div class="n">${alt}</div></div>`;

  // ── TESHIS: sayilardan "su an ne yapmali" cikar ────────────────────────────
  // ★2026-08-15: operator acil durumda 10 eylem arasindan dogru olani secmek
  // zorunda kalmamali. Sayfa duruma bakip ONERILEN eylemi one cikarir ve
  // NEDEN'ini yazar. ("Hangi durumda neyi kullanmam gerektigini soylesin.")
  const acikN = Number(o.acikCihaz) || 0;
  const adbN = Number(o.adbBagli) || 0;
  const topN = Number(o.toplamCihaz) || 0;
  const dN = Number(o.dState) || 0;

  let teshis, onerilen = [], teshisRenk;
  if (!saglikli) {
    teshisRenk = '#e74c3c';
    teshis = `<b>systemd yanit vermiyor (${o.systemdMs} ms).</b> Bu, SSH'in da acilmadigi kilidin imzasidir. ` +
      'Neredeyse her zaman sebep, arka planda calisan bir acilis/onarim betigidir.';
    onerilen = ['durdur-betikler', 'durdur-kapilar', 'panik'];
  } else if (dN >= 50) {
    teshisRenk = '#f39c12';
    teshis = `<b>D-state ${dN}</b> — surecler diskte/agda bekliyor, fren esigi 50. Sistem sisiyor: ` +
      'once acilis betiklerini kes, 1-2 dakika bekle.';
    onerilen = ['durdur-betikler', 'durdur-kapilar'];
  } else if (topN && acikN < topN * 0.9) {
    teshisRenk = '#f39c12';
    teshis = `<b>${topN - acikN} cihaz kapali</b> (${acikN}/${topN}). Sistem saglikli, yani cihazlar ` +
      'kendiliginden acilabilir; once bekleyen acilis kapilarini serbest birak.';
    onerilen = ['durdur-kapilar', 'sifirla-agent'];
  } else if (acikN && adbN < acikN * 0.9) {
    teshisRenk = '#f39c12';
    teshis = `<b>Cihazlar acik ama ${acikN - adbN} tanesine ADB ile ulasilamiyor.</b> ` +
      'Genelde agent/ADB katmani takilmistir.';
    onerilen = ['sifirla-agent'];
  } else {
    teshisRenk = '#2ecc71';
    teshis = `<b>Her sey normal.</b> systemd ${o.systemdMs} ms &middot; D-state ${dN} &middot; ` +
      `${acikN}/${topN} cihaz acik &middot; ${adbN} ADB bagli. <b>Mudahaleye gerek yok</b> — ` +
      'asagidakileri yalnizca bir sorun gordugunde kullan.';
    onerilen = [];
  }

  const btn = (ad, vurgu) => {
    const e = EYLEMLER[ad];
    if (!e) return '';
    const url = `/kurtar/eylem?ad=${ad}&token=${t}${e.tehlikeli ? '&onay=evet' : ''}`;
    const cls = `b${e.tehlikeli ? ' teh' : ad.startsWith('log-') ? ' log' : ''}${vurgu ? ' one' : ''}`;
    const onay = e.tehlikeli
      ? ` onclick="return confirm('SUNUCU YENIDEN BASLATILACAK.\\n\\nCalisan tum cihazlar kapanir, yeniden acilmasi ~20 dakika surer.\\n\\nOnce digerlerini denedin mi?')"`
      : '';
    return `<a class="${cls}" href="${url}"${onay}><b>${vurgu ? '👉 ' : ''}${ad}</b><span>${e.aciklama}</span></a>`;
  };

  const grup = (baslik, aciklama, adlar) => {
    const kalan = adlar.filter((a) => !onerilen.includes(a) && EYLEMLER[a]);
    if (!kalan.length) return '';
    return `<h2>${baslik}</h2><div class="ga">${aciklama}</div>${kalan.map((a) => btn(a, false)).join('')}`;
  };

  const butonlar =
    (onerilen.length ? `<h2>⚡ Onerilen — sirayla dene</h2>${onerilen.map((a, i) => btn(a, i === 0)).join('')}` : '') +
    grup('1 &middot; Once bunu dene', 'Yayin/panel kopmus ama cihazlar calisiyorsa. En zararsiz mudahale.', ['sifirla-agent']) +
    grup('2 &middot; Sistem tikaliysa', 'systemctl yanit vermiyor veya D-state tirmaniyorsa. <b>Cihazlar KAPANMAZ.</b>', ['durdur-betikler', 'durdur-kapilar', 'durdur-agent', 'baslat-agent', 'panik']) +
    grup('3 &middot; Once bak, sonra karar ver', 'Ne oldugunu anlamak icin kayitlar. Hicbir seyi degistirmez.', ['log-izle', 'log-fren', 'log-watchdog']) +
    grup('4 &middot; Son care', 'Yukaridakilerin HICBIRI ise yaramadiysa. Cihazlar kapanir, donus ~20 dakika.', ['reboot-zorla']);

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kurtarma</title><style>
*{box-sizing:border-box}
body{background:#0d0d0f;color:#e8e8ea;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0 auto;padding:16px;max-width:900px}
h1{font-size:19px;margin:0 0 3px}
.sub{color:#7a7a85;font-size:13px;margin-bottom:14px}
.rozet{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px;margin-bottom:18px}
.c{background:#18181c;border:1px solid #232329;border-radius:12px;padding:12px}
.k{color:#8a8a95;font-size:11px;text-transform:uppercase;letter-spacing:.6px}
.v{font-size:25px;font-weight:650;margin-top:3px;line-height:1.1}
.n{font-size:11px;color:#7a7a85;margin-top:3px}
h2{font-size:13px;color:#8a8a95;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.6px}
.b{display:block;background:#1e1e24;border:1px solid #2c2c34;border-radius:12px;padding:13px 15px;margin-bottom:9px;text-decoration:none;color:#e8e8ea}
.b:active{background:#26262e}
.b b{display:block;font-size:15px;margin-bottom:2px}
.b span{font-size:12px;color:#8a8a95}
.b.log{opacity:.7}
.b.teh{background:#2a1416;border-color:#5c2226}
.b.teh b{color:#ff6b6b}
.b.one{background:#13301f;border-color:#2c6b45}
.b.one b{color:#4ade80;font-size:16px}
.teshis{border-radius:12px;padding:14px;margin-bottom:18px;font-size:13.5px;line-height:1.65;background:#18181c;border:1px solid #232329;border-left-width:4px}
.ga{font-size:12px;color:#7a7a85;margin:-2px 0 8px;line-height:1.5}
.uyari{background:#18181c;border:1px solid #232329;border-radius:12px;padding:12px;font-size:12.5px;color:#a8a8b2;line-height:1.6}
</style></head><body>
<h1>🔧 Kurtarma</h1>
<div class="sub">SSH ve systemd olse bile calisir &middot;
<span class="rozet" style="background:${saglikli ? '#123d24' : '#3d1214'};color:${renk(!saglikli)}">${saglikli ? '🟢 SISTEM SAGLIKLI' : '🔴 SISTEM TIKALI'}</span></div>
<div class="g">
${kart('systemd yaniti', `${o.systemdMs}<span style="font-size:14px;color:#6a6a75">ms</span>`, 'esik 5000 &middot; ASIL sinyal', renk(!saglikli))}
${kart('D-state', o.dState, 'fren esigi 50', renk(Number(o.dState) >= 50))}
${kart('Acik cihaz', `${o.acikCihaz}<span style="font-size:14px;color:#6a6a75">/${o.toplamCihaz}</span>`, 'gercek container')}
${kart('ADB bagli', o.adbBagli, 'komut alabilir')}
${kart('Bos RAM', `${o.ramBosGb}<span style="font-size:14px;color:#6a6a75">GB</span>`, `toplam ${o.ramToplamGb} GB`)}
${kart('Load', String(o.load).split(' ')[0], 'bu hostta YANILTICI')}
</div>
<div class="teshis" style="border-left-color:${teshisRenk}">🔎 ${teshis}</div>
${butonlar}
<h2>Not</h2>
<div class="uyari">
Bu sayfa <b>systemd'ye bagimli degildir</b>: eylemler <code>systemctl</code> yerine dogrudan
<code>pkill</code> kullanir, cunku kilit anlarinda <code>systemctl</code> yanit vermiyor.<br><br>
<b>Cihazlar kapanmaz</b> — "panik" dahil hicbir eylem calisan cihazlari durdurmaz;
yalnizca acilis betikleri ve agent durur.<br><br>
Ayni islemler <b>Telegram</b>'dan token'siz da yapilabilir:
<code>/kilitdurum</code> &middot; <code>/agentsifirla</code> &middot; <code>/panik</code>
</div>
</body></html>`;
}

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
    const ozet = {
      ...d,
      systemdMs: ms,
      systemdSaglikli: ms <= 5000,
      acikCihaz: acik.ok ? acik.out : '?',      // GERCEK container (bridge uyesi)
      toplamCihaz: toplam.ok ? toplam.out.trim() : '?',
      systemdSayimi: sysd.ok ? sysd.out : '?',  // yaniltici olabilir -- bilgi amacli
      adbBagli: adb.ok ? adb.out : '?'
    };
    // ★2026-08-15: TARAYICIDAN gelene TIKLANABILIR sayfa ver.
    // Onceki surum sadece JSON donuyordu: eylemler LISTELENIYOR ama tiklanacak
    // bir sey yoktu -> operator acil durumda elle URL yazmak zorundaydi.
    // ("Bu sayfadan nasil kurtaracagiz ki?") Acil mudahalede tek dokunus sart.
    // curl/API cagrilari JSON almaya devam eder (Accept basligina bakiyoruz).
    if ((req.headers.accept || '').includes('text/html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(durumSayfasi(ozet, geldi));
    }
    return gonder(200, { ...ozet, eylemler: Object.fromEntries(Object.entries(EYLEMLER).map(([k, v]) => [k, v.aciklama])) });
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
    // Tarayicidan gelene okunabilir sonuc + geri donus baglantisi ver.
    if ((req.headers.accept || '').includes('text/html')) {
      const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ad)}</title><style>
body{background:#0d0d0f;color:#e8e8ea;font-family:system-ui,-apple-system,sans-serif;margin:0 auto;padding:16px;max-width:900px}
h1{font-size:19px;margin:0 0 12px}
pre{background:#18181c;border:1px solid #232329;border-radius:12px;padding:13px;overflow-x:auto;font-size:12.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
a{display:inline-block;margin-top:14px;background:#1e1e24;border:1px solid #2c2c34;border-radius:12px;padding:12px 18px;text-decoration:none;color:#e8e8ea;font-weight:600}
.d{font-size:13px;color:#8a8a95;margin-bottom:10px}
</style></head><body>
<h1>${r.ok ? '✅' : '❌'} ${esc(ad)}</h1>
<div class="d">${esc(e.aciklama)}</div>
<pre>${esc(r.out || (r.ok ? 'tamam (cikti yok)' : 'hata'))}${r.err ? '\n\n[stderr]\n' + esc(r.err) : ''}${r.timedOut ? '\n\n⚠️ ZAMAN ASIMI' : ''}</pre>
<a href="/kurtar/durum?token=${encodeURIComponent(geldi)}">← Kurtarma sayfasina don</a>
</body></html>`);
    }
    return gonder(200, { eylem: ad, ok: r.ok, cikti: r.out, hata: r.err, zamanAsimi: r.timedOut });
  }

  return gonder(404, { hata: 'yok', yollar: ['/kurtar/durum', '/kurtar/eylem?ad=<eylem>'] });
});

server.listen(PORT, HOST, () => log(`kurtarma ucu dinliyor ${HOST}:${PORT}`));
