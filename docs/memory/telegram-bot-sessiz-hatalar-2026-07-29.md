---
name: telegram-bot-sessiz-hatalar-2026-07-29
description: "★★TELEGRAM BOT SESSİZ-HATA SINIFI (29 Tem): 'komuta basıyorum bir şey olmuyor'un KÖKÜ — Telegram '/' menüsü ÇIPLAK komut yollar (/sil), parser ise boşluk şart koşuyordu → 'Anlamadım'. 4 komut kırıktı. Ayrıca: şifreli gövde ham basılıyordu, 4096 aşan liste SESSİZCE gitmiyordu, buton hatası operatöre HİÇ bildirilmiyordu, /tani DB çökünce 'her şey yolunda' diyordu."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T03:29:40.589Z
---

# Telegram bot — sessiz hata sınıfı (29 Tem 2026)

Operatörün şikâyeti: *"komuta basıyorum bir şey olmuyor"* + *"şifreli yazılar geliyor"*.
Tek tek beklemek yerine botun tamamı denetlendi; aynı sınıftan 8 kusur çıktı.

## ★★ 1. ÇIPLAK KOMUT → "Anlamadım" (en pratik kusur)

Telegram'ın **"/" komut menüsünden** bir komuta dokunulduğunda bota **argümansız** hâli
gider (`/sil`). Dispatcher ise yalnızca boşluklu biçimi kabul ediyordu
(`lower.startsWith('/sil ')`) → çıplak hâl hiçbir dala düşmüyor, en sondaki `else`'e
düşüp **"Anlamadım."** diyordu. Kullanım örneği de hiç görünmüyordu.
**Kırık olanlar:** `/profilisim` · `/sil` · `/etiket` · `/adver`
(`/profilresim` doğruydu — `lower === '/profilresim'` içeriyordu.)

**FIX:** `isCmd(lower, 'ad')` yardımcısı — `/ad`, `ad`, `/ad <arg>`, `ad <arg>` dördünü de
eşler. ⚠️ **Yanlış eşleşme yapmamalı**: `/silme` ≠ `/sil`, `/etiketler` ≠ `/etiket`
(ikincisi AYRI bir komut) — test edildi, 11/11 geçti.

## ★ TÜRKÇE BÜYÜK-İ TUZAĞI

`'İ'.toLowerCase()` JavaScript'te **`'i' + U+0307`** (birleşen nokta) üretir. Bu yüzden
`lower.startsWith('/profilİsim ')` gibi koşullar **ASLA** eşleşmez — dosyada birkaç tane
vardı (`/okunmamış`, `/kişiler`, `/sağlık` da aynı). `normCmd()` birleşen noktayı ve
ı/ş/ğ/ü/ö/ç'yi normalize ediyor.

## 2. Şifreli gövde HAM basılıyordu

Mesaj gövdeleri AES-256-GCM şifreli saklanır. Telegram'ın **doğrudan prisma sorgusu**
yaptığı iki yerde (`renderAllUnread`, `renderRecentInbound`) çözme yoktu → operatör
`VIki/047Wc+XEa2cElErBN83Xt…` görüyordu. Servis katmanı (`whatsapp.service`) zaten
`safeDecrypt` uyguluyor, o yüzden diğer ekranlar güvenliydi.
⚠️ `safeDecrypt` çözemezse girdiyi **AYNEN** döndürür → tek başına yetmez. `looksEncrypted()`
sezgisi (uzun, boşluksuz, base64-benzeri) eklendi ve en çok kullanılan iki ekrana
(`renderChatList`, `renderThread`) da koruma konuldu.

## 3. 4096 KARAKTER — uzun listeler SESSİZCE gitmiyordu

Telegram tek mesajda 4096 karakter kabul eder. `/hesaplar` (40 satır), `/kisiler` (40),
`/okunmamistum` (30), `/sonmesajlar` (25) bunu aşınca API isteği **reddediyor**,
`sendMessage`'ın `.catch()`'i hatayı yutuyordu → **operatör hiçbir şey görmüyordu**.
FIX: `sendMessage` metni satır sınırında ~3900'lük parçalara bölüyor; butonlar yalnızca
SON parçaya ekleniyor.

## 4. Buton/komut hatası operatöre HİÇ bildirilmiyordu

En dıştaki `catch` yalnızca `logger.warn` yapıyordu → handler içinde fırlayan her hata
**tam sessizlik** üretiyordu. FIX: hata artık operatöre de yazılıyor
("İşlem tamamlanamadı… /tani ile kontrol edin").

## 5. Oturum kaybı (state bellekte)

`botStates` **bellekte**; API restart'ında sıfırlanır ama operatörün sohbetindeki **eski
butonlar** durur. `state.browseDeviceId!` undefined'a düşüp `listConversations` patlıyor,
hata yutuluyordu → butona basınca hiçbir şey olmuyordu. FIX: `renderChatList` başında
kontrol + "Oturum sıfırlandı, cihazı yeniden seçin" + cihaz seçici.

## 6. `/tani` DB çökünce "HER ŞEY YOLUNDA" diyordu ★en tehlikeli

Tüm sorgular `.catch(() => boş)` idi; DB tamamen çökerse rapor
`0 cihaz · alarm yok · her şey sessiz` diye **sağlıklı** görünüyordu. Acil-teşhis
komutunda bu ölümcül. FIX: başarısız sorgu sayılıyor ve rapor **en üstte** uyarıyor.

## 7. `/kur` sessizce yanlış sayıda cihaz kuruyordu

Argümansız `/kur` → sessizce **1 cihaz kurardı** (operatör sadece komuta basmıştı!).
`/kur 100` → regex `\d{1,2}` yalnızca "10"u yakalar, 20'ye kırpar ve **uyarı vermeden**
20 cihaz kurardı. Gerçek para/gerçek filo sonucu. FIX: argümansızsa kullanım metni,
geçersizse net hata, kırpma varsa açık uyarı.

## 8. Yalancı başarı onayı

`markRead` hatası yutulup **koşulsuz** "Okundu işaretlendi" deniyordu. FIX: sonuca göre.

## 9. ★BOŞLUKLU NUMARA / OTP — üç katmanda birden düzeltildi

**Bug:** `/testmesaj 90 555 111 22 33 Merhaba` → açgözlü desen `(\+?\d[\d\s]{4,})`
boşlukları yuttuğu için mesaj metni **numaraya karışıyor**, operatörün yazdığı metin
kayboluyor ve **gerçek kişiye** varsayılan "Test mesajı ✅" gidiyordu. Aynı desen
`/gonder` kısayolunda da vardı.

**Ortak çözüm:** `apps/api/src/lib/phone.ts`
- `normalizePhoneInput()` — ayırıcıları (boşluk/tire/parantez/nokta) ve `00` önekini
  temizler. **Rakamlara dokunmaz, ülke kodu UYDURMAZ**; belirsizse `null` döner
  (sessiz yanlış-numara, hata mesajından beterdir).
- `normalizeOtpInput()` — SMS'ten kopyalanan `123 456` / `123-456` kabul.
- `splitLeadingPhone()` — metnin başındaki numarayı ayırır.
  ⚠️**KRİTİK EŞİK:** ayırıcıdan sonra yalnızca numara **12 haneye ulaşmadıysa** devam
  eder. Erken kesersen (10) boşluklu numaranın son hanesi mesaja kaçar; hiç kesmezsen
  rakamla BAŞLAYAN mesaj ("…22 33 **2 adet** lazım") numaraya karışır. İkisi de canlı
  testte yaşandı; 12 hane doğru değer.

**Bağlandığı yerler:** Telegram (`/testmesaj`, `/gonder`) · Public API
(`/v1/whatsapp/register`, `.../otp`) · tek-tık WA modalının backend'i
(`batch.controller` `startRegisterSchema` + `provideOtpSchema`).
Normalizasyon **zod `.transform()`** içinde → servis katmanına hep temiz veri gider.
⚠️ `otpCode` üst sınırı 8→16 yapıldı (ayırıcılarla gelebilir); normalize SONRASI
4-8 hane doğrulanır. Servis katmanı zaten `replace(/[^\d]/g,'')` yapıyordu — bozulmadı.
**Test: 14/14 ayrıştırma + 13/13 şema (eski biçimler dahil regresyon).**

## 10. Diğer düzeltilenler (aynı turda)

- `'read'` (Mesajları Oku) handler'ı vardı ama **hiçbir buton göndermiyordu** → ana
  menüye eklendi (readpick akışı artık erişilebilir).
- `/kayit` dispatcher'da vardı, palette/menüde yoktu → eklendi.
- Alarm saatleri **UTC** basılıyordu (TR'de 3 saat geri, olay zamanı yanlış okunuyordu)
  → `Intl` + `FLEET_TZ` (varsayılan `Europe/Istanbul`). Günlük özetin gönderim saati de
  artık yerel saate göre (aksi halde "sabah 9" TR'de 12:00 olurdu).

## 11. `loadBots` sessiz bot kaybı — DÜZELTİLDİ

İki ayrı sessiz eleme vardı: (a) `catch { /* skip malformed */ }` — `configEnc`
çözülemezse (anahtar rotasyonu/bozuk kayıt) bot listeden düşüyordu; (b) `if (botToken
&& chatIds.length && workspaceId)` — eksik alan sessizce atlanıyordu. Her iki durumda
bot **kalıcı olarak susuyor, log bile yazılmıyordu** → "bot ölmüş" diyorsun, sunucuda
hiçbir iz yok. Artık her eleme sebebiyle loglanıyor; ayrıca kanal tanımlı ama hiçbiri
kullanılabilir değilse `error` seviyesinde tek satır özet düşüyor.

İlgili: [[telegram-13-komut-suite-2026-07-24]] · [[bildirim-kaliciligi-ekran-kurtarma-2026-07-29]]
