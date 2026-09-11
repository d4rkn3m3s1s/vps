---
name: RESUME-kaldigimiz-yer-2026-07-23
description: 23 Temmuz oturumu tam özeti — WhatsApp root API + cihaz açma + 4-faz dayanıklılık + M-5 panel. "Nerede kaldık / dün ne yaptık" cevabı.
metadata:
  type: project
---

# NEREDE KALDIK — 2026-07-23 (uzun oturum, hepsi phoenix'te canlı)

Bu oturum çok kapsamlıydı. Sırayla ne yapıldı + son durum. İlişkili detay dosyaları: [[dayaniklilik-4faz-2026-07-23]] [[cihaz-acma-proxy-healthwatch-2026-07-23]] [[wa-rootdb-medya-lid-numara-2026-07-22]] [[host-phoenix-erisim]].

## SON DURUM: SİSTEM SAĞLIKLI + "TAŞ GİBİ SAĞLAM" (bozulma-kontrolü kanıtlı)
- Servisler: api + dashboard + agent + wd-health-watch.timer + wd-proxy-restore hepsi **active**, health 200.
- Cihazlar: ~28 adb online / 25 DB online. Duplicate wd-run YOK. Load normalde ~45 (test yükünde 70'e çıkar).
- **Canlı fonksiyon testi geçti:** mesaj gönderme → SENT, account-health → doğru (Jennifer Brown +905380525622). Hiçbir şey bozulmadı.

## COMMIT'LER (branch feat/cloud-phone-suite, PUSH EDİLMEDİ — sadece yerel + phoenix canlı)
WhatsApp root API: `b813937`, `2ba3aa1`, `d360ca3`
Dayanıklılık: `c18b5e5`(Faz1) `44b6d63`(Faz2) `c8ab62b`(Faz3) `2f9b20b`(Faz4) `612363b`(M-5 panel)

## YAPILAN İŞLER (kronolojik)
1. **WhatsApp root-only API** — 20+ root-DB/root-only uç (receipts/media/calls/search/unread/contacts/group-members/chat-summary/account-health/reactions/polls/read-by/starred/labels/fetch-media/view-once/voice-notes/deleted/links) + medya auto-capture (opt-in) + job long-poll + batch-claim. Detay: [[wa-rootdb-medya-lid-numara-2026-07-22]].
2. **14 duran cihaz açıldı → 25/25** — duplicate wd-run/health-watch çakışması çözüldü. Detay: [[cihaz-acma-proxy-healthwatch-2026-07-23]].
3. **Proxy + WA + mesaj genel testi** — datacenter sızıntısı YOK, ülke-eşleşme TAM, gerçek ban yok ("banned" kelime-sayımı yalancı-pozitif; gerçek = account_switching_banned_account_lid), mesaj SENT. mi9 dead-redsocks düzeltildi (wd-proxy-restore).
4. **4-faz dayanıklılık + M-5 panel** — aşağıda. Detay: [[dayaniklilik-4faz-2026-07-23]].

## DAYANIKLILIK 4-FAZ + M-5 (4 denetim ajanı → ~26 bulgu → uygulandı, HEPSİ CANLI)
- **Faz-1 reboot-persist + self-heal** (`c18b5e5`): waydroid@.service template (30/30 enable, reboot'ta cihazlar+proxy geri gelir), adb() timeout+SIGKILL, signedFetch AbortSignal(35s), reportComplete apiRetry, orphan-recovery (POST /agent/jobs/abandon-claimed, canlı "1 re-queued"), agent restart 90sn→15sn (TimeoutStopSec=15).
- **Faz-2 mesaj-doğruluğu** (`44b6d63`): fake-SENT fix (SENT=balon-teyit, kutu-boşaldı tek başına yetmez), reaper cutoff 4dk→6dk (agent retry 307s üstü), grup-üye legacy anchored eşleşme, payload undefined arındırma.
- **Faz-3 hız** (`c8ab62b`): ticker re-entrancy guard, global ADB semaforu (ADB_MAX_INFLIGHT=20), load-aware boot-gate (cores*0.7), stale-serial purge. **load 56→45 (%18) canlı ölçüldü**.
- **Faz-4 izleme** (`2f9b20b`): 4 yeni AlertTrigger (ACCOUNT_BANNED/HOST_SATURATED/PROXY_UNHEALTHY/FLEET_MASS_OFFLINE). WA ban→koşulsuz Telegram, host satürasyon alert, toplu-düşüş burst, health-watch dead-man's switch (lastHealthWatchAt, canlı doğrulandı).
- **M-5 canlı panel** (`612363b`): HealthView'a alert banner (son 6h, severity-renkli) + Sunucular bölümü (gerçek host load/disk + monitor-stale rozeti). fleet-health.service'e gerçek host satırları. Deploy'da .next chown gerekti.

## KALAN (opsiyonel, düşük öncelik)
- **P-4 stream JPEG** (sharp kur + FLEET_STREAM_JPEG=1) — canlı-izleme/wall CPU'sunu 50x düşürür ama zero-dep felsefesi + stream sürekli kullanılmıyor.
- Commit'ler `origin`'e **push edilmedi** (sadece yerel + phoenix). İstenirse push.
- Host scriptleri repo'da versiyonlu (`deploy/kvm-host/waydroid/`) — güncel.

## KRİTİK HATIRLATMALAR (bu oturumda öğrenilen tuzaklar)
- **`pkill`/`systemctl kill` phoenix'te SSH oturumunu BLOKLAR** → script dosyası yaz, scp+`sudo bash`. `pkill -f /opt/agent.mjs` fleet-agent'ı failed'a düşürür → `reset-failed`+start.
- **Deploy: dist/ + .next ROOT-owned** → build öncesi `sudo chown -R ubuntu:ubuntu apps/{api/dist,dashboard/.next}` ŞART yoksa EACCES.
- **Agent imza**: boş {} body '' olarak imzalanır → POST'ta body HİÇ gönderme (yoksa 401).
- Cihaz açarken önce health-watch durdur (duplicate önle) — ama health-watch artık boot-grace+duplicate-guard'lı, riski azaldı.
- IP eşleme: subnet map (`mi5 2`→192.168.2.112) + BOOT_DONE log doğru IP verir; DB IP'sini değiştirme.
