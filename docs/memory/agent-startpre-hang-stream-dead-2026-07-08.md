---
name: agent-startpre-hang-stream-dead-2026-07-08
description: "Canlı yayın 'bağlanıyor'da kalıyor KÖK NEDEN = fleet-agent ExecStartPre 'adb connect' offline cihaza 90s takılıp start-pre timeout → agent HİÇ başlamıyor (stream WS yok). ÇÖZÜM override.conf'tan ExecStartPre kaldır"
metadata: 
  node_type: memory
  type: reference
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-08 KÖK NEDEN + ÇÖZÜM★ Kullanıcı: "cihaz Çalışıyor diyor ama canlı yayın açılmıyor,
bağlanıyorda kalıyor". mi7 (192.168.252.57) ADB erişilebilir, DB ONLINE, screencap 10MB döndü
(ekran sağlam), FLEET_STREAM_JPEG=1 + sharp mevcut, Node v22 (WebSocket var). Ama yayın ölü.

**TEŞHİS ZİNCİRİ:**
- API log: "[stream] viewer accepted" VAR ama agent'tan FRM/frame HİÇ gelmiyor.
- API log: "Stream agent connected" = 0 kez → agent `/ws/agent-stream` WS'e HİÇ bağlanmamış.
- stream.hub `toAgent(hostId)` → `this.agents.get(hostId)` boş → `stream.start` sessizce kaybolur
  → viewer sonsuza "bağlanıyor"da kalır. (agents.set sadece agent-stream upgrade'inde olur.)
- `ss -tnp | grep :4000` → agent pid'inin :4000'e HİÇ bağlantısı yok (ne WS ne HTTP job-poll).
- `systemctl status fleet-agent` → **Active: activating (start-pre)** — servis start-pre'de TAKILI.
- journal: **"start-pre operation timed out. Terminating"** → Restart=always → sonsuz döngü.

**KÖK NEDEN:** override.conf'ta `ExecStartPre=-/usr/bin/adb connect 192.168.248.112:5555`.
.248.112 (work) OFFLINE → `adb connect` 90sn TAKILIR → systemd default TimeoutStartSec aşılır →
start-pre öldürülür → ana ExecStart (node /opt/agent.mjs) **HİÇ ÇALIŞMAZ** → stream WS yok, job
çekilmez. `-` prefix hatayı yoksayar ama HANG'i çözmez (timeout yine tetiklenir). Ayrıca
`/proc/PID/environ` boş görünür çünkü ana process hiç doğmamış (start-pre'de ölüyor).

**KANITLI ÇÖZÜM:**
```
# /etc/systemd/system/fleet-agent.service.d/override.conf
[Service]
Environment=FLEET_API_URL=http://127.0.0.1:4000
Environment=FLEET_API_KEY=<API_KEY>
ExecStartPre=          # ← BOŞ satır tüm ExecStartPre'leri SIFIRLAR (adb connect'leri kaldırır)
```
`systemctl daemon-reload; systemctl reset-failed fleet-agent; systemctl restart fleet-agent`
→ `active (running)`, NRestarts=0. Agent log: "starting — polling" + **"stream channel connected"**.
API log: "Stream agent connected". Agent WS iki ESTAB :4000 bağlantı. Agent job alınca kendi ADB
bağlantısını zaten yapıyor → ExecStartPre adb connect GEREKSİZ + ölümcül.

**İKİNCİ DERS:** API'yi (fleet-api) her restart ettiğinde agent'ın açık WS'leri (agent-stream +
job-poll) düşer; agent 5sn'de yeniden bağlanır AMA start-pre bozuksa geri gelemez. Deploy sonrası
`systemctl restart fleet-agent` ŞART (memory [[faz3-wake-sleep-reboot-deploy-2026-07-07]] ile aynı).

**AGENT LOG YERİ:** journald DEĞİL → `/var/log/fleet-agent.log` (StandardOutput=append). Agent'ı
teşhis ederken `tail /var/log/fleet-agent.log`. journalctl -u fleet-agent sadece systemd olayları.

**TODO (kullanıcı istedi):** Bunu dashboard'dan HER CİHAZ için butonla çözmek — "Yayını yenile/
Agent'ı tazele" → ADB reconnect + stream.start yeniden gönder (stream.hub'da resumeStreamsForHost
zaten var, bir endpoint'e bağlanmalı). [[live-stream-fix]] [[adb-instability-fps-fix-2026-07-07]]
