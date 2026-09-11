---
name: resume-kaldigimiz-yer-2026-07-29
description: "★İLK BUNU AÇ (29 Tem). ★★YARIN İLK İŞ: 10 WhatsApp kaydı — 10 cihaz hazır, hepsi TR + benzersiz IP. Bugün: proxy ülke-havuzu kökü bulundu (TR→mobile taşındı, 17/38→38/38), cihaz ekran kurtarma (8/8 takılı cihaz), kalıcı bildirim tablosu, Telegram operasyon komutları (/tani /kurtar /proxy /ozet /acil) + 11 sessiz-hata düzeltmesi, boşluklu numara/OTP 3 katmanda. ⚠️ HİÇBİRİ COMMIT EDİLMEDİ (29 unpushed commit + ~25 değişik dosya)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T03:33:32.894Z
---

# ★ KALDIĞIMIZ YER — 2026-07-29 (gece 03:30)

## YARIN İLK İŞ: 10 WhatsApp kaydı
Filo hazır: **38/38 WhatsApp erişimi**, 38/38 ADB online, takılı ekran 0.
10 kayıt cihazı hepsi **TR ve benzersiz IP**:
`wa-g6gm · wa-cu99 · wa-8dzz · wa-fber · wa-n42r · wa-wsle · hiz-test2 · hiz-test · wa-w4bp · wa-e23k`

⚠️ Kayıt öncesi o cihazın çıkış IP'sini bir kez doğrula (sticky oturum oturmuş mu) —
proxy havuzu paylaşımlı olduğu için ara sıra iki cihaz aynı IP'ye düşebiliyor.

## BUGÜN ÇÖZÜLENLER (hepsi canlı doğrulandı)

1. **★★PROXY ÜLKE-HAVUZU** — dünkü "mobile hesap öldü" teşhisi YANLIŞMIŞ. Gerçek:
   residential hesabın **country-TR havuzu** 502 veriyor (AL/US sorunsuz), mobile TR'yi
   veriyor. 28 Tem'de tüm filoyu residential'a taşımak bu yüzden hataydı → 38/38 iken
   17/38'e düşmüştü. **TR→mobile(9999), AL→residential(5555)** → **38/38**.
   [[api-restart-agent-stream-proxy-tasima-2026-07-29]]
2. **★★KillMode** — `wd-health-watch` oneshot servisi bitince systemd, kurtarmanın
   başlattığı **redsocks'u öldürüyordu**; log "✓ kurtarıldı" derken cihaz kopuk kalıyordu.
   `KillMode=process` ile hem yeni hem AYLARDIR sessizce başarısız olan "ölü redsocks"
   kurtarması çalışır oldu.
3. **★★CİHAZ EKRAN KURTARMA** — 38 cihazın 8'i izin diyaloğu/ContactPicker'da takılıydı,
   RUNNING job yoktu (hiçbir job bitiminde ekran temizlenmiyordu). runJob'a ortak
   `finally`+`returnToHome`, paket-bağımsız `dismissPermissionDialog` (TR metinler
   eksikti), reaper kapsamı genişletildi → **8/8 kurtarıldı**.
   [[bildirim-kaliciligi-ekran-kurtarma-2026-07-29]]
4. **KALICI BİLDİRİM** — `Notification` tablosu + feed API + panel hidrasyonu. Eskiden
   `useState([])` idi: yenilemede kayboluyor, "sen yokken bitenler" hiç görünmüyordu.
5. **PUBLIC API KATEGORİLERİ** — 52 uç düz listeydi; boş cihaza `send` 409 yerine job
   açıyordu. 5 kategori + capabilities ucu + eski yollar kırılmadan alias.
   [[public-api-kategori-mimarisi-2026-07-29]]
6. **TELEGRAM** — `/tani /kurtar /proxy /ozet /acil` + kritik alarmda aksiyon butonu +
   günlük özet + 11 sessiz-hata düzeltmesi (çıplak komut, şifreli gövde, 4096 sınırı,
   yanlış-mesaj bug'ı…). [[telegram-bot-sessiz-hatalar-2026-07-29]]
7. **AGENT STREAM** — API restart'ında yayın zombie kalıyordu; ping/pong watchdog ile
   kalıcı çözüldü (canlı: API restart → agent 6 sn'de kendi kendine bağlandı).

## ⚠️ AÇIK İŞLER

- **GİT TEMİZ** — çalışma ağacı boş, dünkü 29 commit push edilmiş, bugünün işi de
  3 commit hâlinde kayıtlı (`7dc4973` bildirim feed'i, `e3380db` telegram ops,
  `2222526` phone normalizasyonu). ⚠️ Bu commit'leri BEN yapmadım (kullanıcı/başka
  bir oturum yapmış) — yani "commit edilmedi" varsayımıyla hareket etme, önce
  `git log --oneline -5` ile bak.
- **`mi68`** (`+905386929621`, hesabı LOGGED_OUT) ara ara kopuyor — hesap ölü, acil değil.
- **WA kayıt başarı oranı** hâlâ ölçülmedi (%18 rakamı 5 kök düzeltmeden ÖNCEKİ dönem).
- Panelde "yenilemede kaybolan" başka durumlar var (WhatsApp sayfasındaki **yazılmış
  mesaj taslağı**, seçili cihaz, açık sohbet, yarım kalan OTP sihirbazı) — bilerek
  dokunulmadı, ayrı tur.
- `JobsView`/`AlertsView` hâlâ eski sessiz-fetch desenini kullanıyor (`lib/safeFetch.ts`
  yazıldı ama oralara geçirilmedi).

## SUNUCU
`ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45` (⚠️`phoenixnap_y` anahtar DOSYASI,
SSH config alias'ı değil). Kod `/opt/fleet`, agent `/opt/agent.mjs`, git YOK → dosya
kopyalanır + `npm run build` + `systemctl restart`. ⚠️`/opt/fleet` dosyaları bazen
`UNKNOWN:UNKNOWN` sahipli olur → scp öncesi `sudo chown -R ubuntu:ubuntu`.
