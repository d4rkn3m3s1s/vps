---
name: resume-kaldigimiz-yer-2026-07-28
description: "★İLK BUNU AÇ (28 Tem). YARIN: 10 WhatsApp kaydı yapılacak, her cihaza 1 numara — 10 cihaz UÇTAN UCA doğrulandı ve HAZIR (TCP/DNS/WA-erişim/ülke/root/a11y 10/10, çıkış IP'leri 10/10 BENZERSİZ, hepsi TR). Cihazlar: wa-g6gm, wa-cu99, wa-8dzz, wa-fber, wa-n42r, wa-wsle, hiz-test2, hiz-test, wa-w4bp, wa-e23k. Bugün 5 KÖK hata çözüldü: proxy .eu→.pr, container'da `ip` PATH, bayat ADB ucu, ufw DHCP→DNS, WA gönderim kilidi. Kurulum 130s→90s. ⚠️13 commit YEREL, PUSH EDİLMEDİ. KALAN: sessiz-yoklama zamanlayıcısı, WA kayıt başarı oranını yeniden ölç (%18 eski)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-28T02:10:48.778Z
---

# ★ KALDIĞIMIZ YER — 2026-07-28 (gece)

## YARIN YAPILACAK: 10 WhatsApp kaydı
Her cihaza **1 numara**. 10 cihaz uçtan uca doğrulandı, **hepsi HAZIR**:

| Cihaz | IP | Cihaz | IP |
|---|---|---|---|
| wa-g6gm | 192.168.35.112 | wa-wsle | 192.168.33.112 |
| wa-cu99 | 192.168.36.112 | hiz-test2 | 192.168.31.112 |
| wa-8dzz | 192.168.37.112 | hiz-test | 192.168.23.112 |
| wa-fber | 192.168.34.112 | wa-w4bp | 192.168.19.112 |
| wa-n42r | 192.168.32.112 | wa-e23k | 192.168.30.112 |

**Ön-uçuş sonucu (10/10):** TCP 301 · DNS var · `web.whatsapp.com` 200 · proxy TR=TR ·
root · WhatsApp kurulu · a11y · DB'de engel yok (bayat kayıt/ban yok).
**★Çıkış IP'leri 10/10 BENZERSİZ** (İstanbul×8, Adana, Bursa) — toplu-kayıt izi yok, sticky.

**Öneri:** kayıtları arka arkaya değil **aralıklı** yap (IP'ler farklı olsa da aynı dakikada
10 kayıt zamanlama deseni yaratır). Tek kayıt numara→OTP ekranı ~30 sn sürüyor.

## BUGÜN ÇÖZÜLEN 5 KÖK HATA (hepsi canlı kanıtlı)
1. **thordata `.eu` → `.pr`** — %15 istekte 502 + ülkeyi bozuyordu (AL→XK).
   Ayrıca **sessid ülke değişimini eziyordu** → `SESSID=<instance><cc>`. [[proxy-eu-pr-endpoint-koku-2026-07-28]]
2. **container'da `ip` HİÇ çalışmıyordu** — servis PATH'inde `/bin` yok → provision route
   eklemiyordu, heal onaramıyordu. [[container-ip-path-koku-2026-07-28]]
3. **Bayat ADB ucu kurulumu öldürüyordu** — silinen cihazın ucu 'offline' kalıyor, subnet
   geri dönüşümünde yeni kurulum boot TIMEOUT. [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]]
4. **ufw DHCP'yi düşürüyordu → cihazlar DNS'siz** → tek-tık WhatsApp sessizce kırık.
   [[ufw-dhcp-dns-koku-2026-07-28]]
5. **WA gönderim koruması eski ban satırına bakıyordu** → banlanmış cihaz yeni numarayla
   bile mesaj atamıyordu. [[wa-saglik-sessiz-yoklama-2026-07-28]]

## HIZ: kurulum 173s → **90s** (boot 114s→31s)
DHCP zaten 22s'de bitiyordu; sorun **tespitteydi** (container-içi okuma 3s timeout'a
takılıyordu) → IP artık **host-tarafı lease dosyasından** okunuyor. `dhcpKick`'in
`ifconfig down` kısmı Android'in DHCP'sini kesiyordu → kaldırıldı.

## YENİ SAĞLAMLIK ÖZELLİKLERİ
- **DNS self-heal** (agent): lease yoksa DNS de yoktur → lease tohumla + restart.
- **Canary** (`wd-canary.sh` + timer, günlük 04:30): gerçek cihaz kur → DNS+çıkış+WA+ülke
  doğrula → sil; hata → Telegram.
- **Sessiz WA yoklaması**: durumu **mesaj göndermeden** WhatsApp'ın kendi banner'ından oku.
- **Telegram `/bakiye`** + `CANARY_FAILED` alarmı artık Telegram'a düşüyor (enum'da yoktu, 400 alıyordu).
- **Dashboard canlı liste**: ProfilesView artık WS olaylarına abone (önce sadece 20s yoklama).

## ⚠️ AÇIK İŞLER
- **13 commit YEREL — PUSH EDİLMEDİ.** (`feat/cloud-phone-suite`)
- **Sessiz yoklama zamanlayıcısı YOK** — şu an istek üzerine. Günlük tur kurulacak.
- **WA kayıt başarı oranı yeniden ölçülmeli**: 13 aktif / 49 başarısız (%18) — bu sayı
  bugünkü 5 kök düzeltmeden ÖNCEKİ dönemi yansıtıyor.
- thordata bakiye **10.4 GB** (son kullanma 2026-08-27), token eklendi, alarm çalışıyor.
- Sadece **residential** hesabın token'ı var; mobile hesabın token'ı eklenirse `/bakiye` onu da gösterir.

## FİLO DURUMU (gece)
36 cihaz online, 0 bayat ADB ucu, agent/API/dashboard/canary-timer aktif, yük düşük.
Sunucu: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45` (⚠️`phoenixnap_y` bir SSH
config alias'ı DEĞİL, anahtar dosyasıdır).
