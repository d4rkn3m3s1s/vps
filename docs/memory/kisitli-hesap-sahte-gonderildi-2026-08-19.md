---
name: kisitli-hesap-sahte-gonderildi-2026-08-19
description: Kısıtlı WhatsApp hesapları "gönderildi" raporluyordu ama mesaj teslim edilmiyordu — msgstore status=20 ile tespit, 3 kök
metadata:
  type: project
---

# 🔴★★★ "GÖNDERİLDİ" DİYİP TESLİM ETMEYEN HESAPLAR

Operatör: *"3 test attım sadece 1'i ulaştı"*. 3 farklı cihazda tekrarlandı: yine 1/3.
**6 gönderimin 6'sı da panelde `SENT`** görünüyordu.

## ★★★TEŞHİS ANAHTARI: `msgstore.message.status`

```
5  = TESLİM EDİLDİ (çift tik)      13 = OKUNDU (mavi)
4  = sunucuya ulaştı               6  = sistem/E2E kaydı
20 = TESLİM EDİLMEDİ  ← başarısızlık
```
⚠️**Sağlam hesaplarda 20 HİÇ görülmedi** (iki çok-mesajlı cihazda ölçüldü) — yani 20
gerçek bir başarısızlık kodu. Kısıtlı cihazın sohbet ekranında:
**"Your account is restricted. You can't start new chats right now."** + kırmızı ünlem.

## ★★★KÖK 1 — Yoklama kısıtlı hesabı ACTIVE sanıyordu

Bir gün önce eklediğim **"yeni sohbet" testi kusurluydu**: WhatsApp **kısıtlı hesapta da
ContactPicker'ı AÇIYOR**; engel ancak sohbet *başlatılınca* çıkıyor. Yani picker'ın
açılması sağlamlık kanıtı **değil**.
FIX: kısıt banner'ı **her sohbette** görünüyor — **resmi WhatsApp sohbetinde de**
(doğrulandı; düğüm kimliği `read_only_chat_info`). Gerçek sohbeti olmayan hesaplarda
önce o sohbet açılıp **metin** aranır.
⚠️**Karar METNE göre verilir, düğüm VARLIĞINA göre DEĞİL** — aynı düğüm resmi sohbette
*"Only WhatsApp can send messages"* ile de dolu olabilir (bu kısıt değil).
Doğrulama: 4 cihaz ACTIVE→RESTRICTED, teslim edebilen 2 cihaz ACTIVE kaldı (4/4 doğru).

## ★★★KÖK 2 — Gönderim ekrana bakıp "SENT" diyordu
Doğrulama yazma kutusunun boşalmasına + giden baloncuğa bakıyordu; ikisi de kısıtlı
hesapta da sağlanıyor. FIX: dönmeden önce msgstore'dan son giden mesajın `status`'u
okunur; **20 ise `ACCOUNT_RESTRICTED`** döner (API bunu hesap sağlığına da yazar).
Canlı test: sağlam cihaz `SENT` (15.5 sn), kısıtlı cihaz `ACCOUNT_RESTRICTED` (36.8 sn).

## ★★KÖK 3 — Araya giren WhatsApp ekranları
Canlı: `com.whatsapp.profile.UsernameManagementFlowActivity`
(*"Usernames are coming soon. Reserve yours today."*) sohbet listesinin **önüne** geçti;
koordinatla dokunan akış oraya girdi.
FIX: `clearWaInterstitial` — ön planda `com.whatsapp` var ama **beklenen ekranlardan biri
değilse GERİ bas**. İleriye dönük (yeni tanıtım ekranları da geçilir).
⚠️`BanAppeal/userban` **beklenen** listesinde — ban tespiti onu görmeli, geçmemeli.

## 🆕 AYRI KÖK — kapalı WhatsApp cihazı SESSİZCE SAĞIR bırakıyor
Operatörün cevabı hiç gelmedi. Cihaz kaydı:
```
23:06:43 Stopping service due to app idle: com.whatsapp
23:06:51 Background start not allowed
23:06:56 ANR in com.whatsapp (CLIENT_PING_PERIODIC)
23:06:56 Killing com.whatsapp (adj 700): bg anr
```
Gönderim sonrası `+HOME` ile arka plana düşen WhatsApp'ı **Android öldürdü**.
⚠️Kod regresyonu **değil** (operatör haklı olarak sordu, cihaz logu aksini gösterdi).
Kapalı WhatsApp'a mesaj **ulaşmaz**; cihaz panelde ONLINE kalır, hata da vermez.
FIX: (1) `dumpsys deviceidle whitelist +com.whatsapp` **140/140 cihaza** uygulandı —
"app idle" ve "background start not allowed" zincirini keser. (2) Ajan 60 sn'de bir
`pidof` bakar, ölüyse geri açar.

Bkz. [[wa-ban-yoklamasi-bayat-on-plan-2026-08-19]] · [[gelen-mesaj-kayip-ve-gecikme-2026-08-19]]
