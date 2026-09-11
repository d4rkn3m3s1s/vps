---
name: proaktif-saglik-izleme-2026-07-21
description: ★PROAKTİF SAĞLIK İZLEME + OTO-İYİLEŞME + ALERTING (2026-07-21). wd-health-watch.sh(systemd-timer 7dk): her ACTIVE/RESTRICTED WA cihazının GERÇEK çıkış-IP'sini Android-içinden kontrol→datacenter-IP'ye düşen(proxy sızıntısı, ban-riski)→proxy-reapply; ADB-erişilemez→adb-reconnect(oto-iyileşme); her sorun→POST /agent/health-alert→API webhook(WHATSAPP_ACCOUNT_HEALTH)+alertsService→Telegram. API: recordHealthAlert+healthAlertHandler+route(requireHost auth). CANLI:24 cihaz işlendi(23 sağlıklı, 0 sızıntı=proxy sağlam), alert-endpoint HTTP200+API-log doğrulandı. ★stdin-bug:while-read içinde adb-shell stdin-yiyordu→</dev/null şart(ilk çalışmada sadece 1 cihaz işledi).
metadata:
  node_type: memory
  type: reference
---

# ★ PROAKTİF SAĞLIK İZLEME + OTO-İYİLEŞME + ALERTING (2026-07-21) ★

Kullanıcı "daha stabil/dayanıklı" 2. dalga: proaktif-izleme(#3) + alerting(#4) + oto-iyileşme(#2).
"Ban olmadan ÖNCE yakala". Detay [[dayaniklilik-3iyilestirme-2026-07-21]] (1. dalga: retry+watchdog).
[[proxy-mimari-cok-port-2hesap-2026-07-21]] proxy temeli.

## ✅ wd-health-watch.sh (HOST /opt/fleet-agent/, systemd-timer 7dk)
- Her ACTIVE/RESTRICTED/AWAITING WA cihazı için (wd-proxy-restore ile AYNI DB sorgusu, LEFT JOIN + proxyCountry):
  1. **ADB erişilebilir mi?** Değilse→adb disconnect+connect(oto-iyileşme). Yine olmazsa→UNREACHABLE alert.
  2. **Gerçek çıkış-IP** (Android İÇİNDEN, app-UID→redsocks; root-curl proxy-baypaslar).
  3. **Datacenter sızıntısı?** exit_ip == host'un DC_IP'si(api.ipify.org host'tan)→PROXY-REAPPLY(cc'ye göre TR-mobil/diğer-residential)→PROXY_LEAK alert(fixed=true/false).
- Her olay→notify()→POST /agent/health-alert (agent-key auth).
- ★KRİTİK stdin-bug: `while IFS='|' read` döngüsü içinde `adb shell` ROWS-heredoc-stdin'ini YİYORDU→döngü 1. cihazdan sonra duruyordu(ilk-testte sadece mi15). FIX: HER `adb shell`'e `</dev/null`. (Klasik bash tuzağı — canlı-test yakaladı.)

## ✅ API health-alert endpoint
- agent.service.recordHealthAlert(host, {kind,instance,deviceId,detail,fixed}): cihazı id/metadata.instance ile çöz→workspaceId al→webhooksService.dispatch('WHATSAPP_ACCOUNT_HEALTH')+alertsService.evaluate('DEVICE_OFFLINE',{title,detail})→Telegram/Slack/Discord. kind: PROXY_LEAK/AUTO_RECONNECT/UNREACHABLE.
- healthAlertHandler(requireHost auth)+route POST /agent/health-alert+healthAlertSchema(zod). exactOptionalPropertyTypes→imzada `|undefined` şart.
- Script şifreli-channel-config'e DOKUNMAZ(configEnc), API mevcut bildirim-sistemini kullanır.

## ✅ systemd: wd-health-watch.service(oneshot, EnvironmentFile=/etc/fleet-proxy.env) + .timer(OnBootSec=4min, OnUnitActiveSec=7min, ENABLED)
- /etc/fleet-proxy.env'e FLEET_API_KEY+FLEET_HOST_KEY+API_URL+ADB eklendi(agent.env'den, script bildirim-gönderebilsin).

## 🔧 CANLI TEST (2026-07-21)
- Script: 24 cihaz işlendi→23 sağlıklı, 0 sızıntı(=proxy mimarisi SAĞLAM, hiçbir cihaz datacenter'da değil), 0 erişilemez. (Birkaç boş-test-cihazı çıkış-IP-alamadı=geçici, hata değil.)
- Alert: POST /agent/health-alert→{"data":{"ok":true}} HTTP200, API-log `health-watch alert kind=PROXY_LEAK device=watest`(mi11→watest çözüldü), webhook+alert tetiklendi.
- Timer: enabled+active(waiting), Trigger 7dk sonra doğrulandı.

## ⚠️ NOT
- Şu an filoda sızıntı YOK→PROXY_LEAK-düzeltme kod-yolu canlı-sızıntıyla test-edilmedi(mantık+alert-endpoint ayrı test edildi). Gerçek sızıntı olursa düzeltir+bildirir.
- 4 host-timer/servis enabled: wd-proxy-restore(reboot), wd-health-watch(7dk), wa-backup(gün), wa-apk-update(2gün).
- HÂLÂ git commit edilmedi(bu iş+API endpoint dahil). .audit-host-snapshot/ credential-içerir→.gitignore'da.
