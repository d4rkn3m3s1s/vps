---
name: wa-saglik-sessiz-yoklama-2026-07-28
description: "WhatsApp hesap-sağlık mimarisi 3 düzeltme. (1)★GÖNDERİM KORUMASI YANLIŞ SATIRA BAKIYORDU: `status:{in:['BANNED','LOGGED_OUT']}` ile cihazda GEÇMİŞTE herhangi bir zaman banlanmış satırı arıyordu → bir kez banlanan cihaz YENİ+ÇALIŞAN numarayla kaydedilse bile bir daha mesaj ATAMIYORDU (kalıcı 409); panel 'sağlıklı' derken API reddediyordu. CANLI: watest ACTIVE(27Tem)+BANNED(16Tem) → fix sonrası SENT. FIX: kartla AYNI kural = EN YENİ satır (createdAt desc). (2)★SAĞLIK DAMGASI TEK-YÖNLÜYDÜ: setAccountHealth monotonik, kodun yorumu 'recovery happens elsewhere' diyor ama o yer HİÇ yazılmamıştı → RESTRICTED/LOGGED_OUT sonsuza kadar kalıyordu. FIX: recoverAccountHealth (BANNED kapsam DIŞI, bilerek). (3)★★SESSİZ YOKLAMA: durumu MESAJ GÖNDERMEDEN oku — WhatsApp'ı aç, MEVCUT sohbeti aç, kendi banner'ını oku. Gönderim-testi YANLIŞ olurdu: kısıtlı hesap mevcut sohbete cevap VEREBİLİR (canlı: 1:24 mesaj çift-tik gitti hesap kısıtlıyken). ⚠️`monkey -c LAUNCHER` WhatsApp'ı AÇMIYOR → `am start -n com.whatsapp/com.whatsapp.HomeActivity`; sohbet satırı `contact_row_container`. commit 8b3073b + ad58355"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-28T02:10:02.874Z
---

# WhatsApp hesap-sağlık: gönderim kilidi + iyileşme + sessiz yoklama (2026-07-28)

Operatör: *"wa yasaklı / wa kısıtlı etiketleri kesin doğru yapıyor mu?"* → denetim →
rozetlerin 9/9'u DB ile birebir uyumlu (uydurma yok, canlı türetiliyor) **ama** iki
gerçek kusur + bir mimari eksik çıktı.

## 1) ★ Gönderim koruması yanlış satıra bakıyordu (kalıcı kilit)
`batch.service` gönderim öncesi kontrolü:
`where: { deviceId, platform:'whatsapp', status: { in: ['BANNED','LOGGED_OUT'] } }`
→ cihazda **geçmişte herhangi bir zaman** banlanmış satır varsa gönderimi 409 ile
reddediyordu. Sonuç: **bir kez banlanan cihaz, yeni ve çalışan numarayla yeniden
kaydedilse bile bir daha mesaj atamıyordu.** Panel bunu göstermiyordu (rozet **en yeni**
hesaba bakıyor = doğru; koruma "hiç banlanmış mı" diye bakıyordu) → panel "sağlıklı"
derken API reddediyordu.
**CANLI:** `watest` → ACTIVE +905015716660 (27 Tem) + BANNED 905391147788 (16 Tem);
fix öncesi 409, fix sonrası aynı gönderim **SENT**.
**FIX:** kartla **aynı kural** — en yeni satır (`createdAt desc`, ara durumlar hariç).

## 2) ★ Sağlık damgası tek-yönlüydü
`setAccountHealth` monotonik (bilerek: ban sinyali yumuşatılamaz) ve kodun kendi yorumu
*"Recovery back to ACTIVE happens elsewhere (a successful send/register)"* diyordu —
**ama o "elsewhere" hiç yazılmamıştı.** RESTRICTED/LOGGED_OUT damgası sonsuza kadar
kalıyordu.
**FIX:** `recoverAccountHealth()` + başarılı `WHATSAPP_SEND` kancası. Telegram'a
"✅ hesap TOPARLANDI" bildirimi. ⚠️**BANNED bilerek kapsam dışı** (yanlış-pozitif bir
"başarılı gönderim" gerçek banı gizleyebilir; ban'dan çıkış yolu yeni numara kaydıdır →
yeni hesap satırı açılır, rozet doğal olarak temizlenir).

## 3) ★★ SESSİZ YOKLAMA — durumu mesaj göndermeden oku
Operatör önerisi: *"cihazlar birbirine mesaj göndersin, çıkan ekrana göre durum belli
olur"*. Fikir doğru; **gönderim şart değil**:
- Gönderim-testi **mantık hatası** taşır: KISITLI hesap **mevcut sohbete cevap
  VEREBİLİR** → "gönderim başarılı ⇒ kısıtlı değil" YANLIŞ.
  **CANLI KANIT:** 1:24'te gönderilen mesaj **çift tikle iletildi** (hesap kısıtlıyken!),
  1:28'deki ikinci mesaj taslakta kaldı.
- Ayrıca her yoklama dışarı trafik = ban sinyali + kota.
**ÇÖZÜM:** WhatsApp'ı aç → **mevcut bir sohbeti aç** (hiçbir şey yazma) → ekrandaki
kendi cümlesini oku. Desenler gönderim akışındakiyle **aynı** (tek kaynak).

### ⚠️ Yoklama yazarken çıkan 2 canlı tuzak
1. **`monkey -p ... -c LAUNCHER` bu imajda WhatsApp'ı AÇMIYOR** (ekranda launcher kalır)
   → ilk sürüm ana ekranı okuyup yanlışlıkla "sohbet yok" dedi.
   **Doğrusu:** `am start -n com.whatsapp/com.whatsapp.HomeActivity`.
2. Sohbet satırı bu sürümde **`contact_row_container`** (`conversations_row_contact_name`
   YOK). Ayrıca **ana ekran banner'ı reklamdır** ("Usernames are coming soon") — kısıt
   uyarısı yalnızca **sohbet açılınca** görünür.
+ **ÖN-PLAN DOGRULAMASI şart:** WhatsApp gerçekten açılmadıysa `UNKNOWN` dön, hüküm verme.

**Uygulama:** `WHATSAPP_ACCOUNT_HEALTH` işi artık kimlik + **durum** döndürür (yeni job
tipi/migration YOK). API sonucu **hem kötüleşme hem iyileşme** yönünde uygular;
`UNKNOWN/unverified` → hiçbir şey yapmaz. Sağlık değişince `deviceHub 'device.updated'`
yayını → ProfilesView zaten abone → **rozet anında güncellenir**.

**CANLI DOĞRULAMA:** hesap test için ACTIVE'e çekildi → yoklama `state=RESTRICTED` buldu
(kanıt: *"Your account is restricted. You can't start..."*) → **otomatik** RESTRICTED'a
geri yazıldı. **Mesaj gönderilmedi.**

⏳ **KALAN:** yoklamayı düzenli çalıştıran zamanlayıcı YOK (şu an istek üzerine).
Canary gibi günlük tur kurulacak.

Bağlantılı: [[saglamlik-dns-heal-canary-2026-07-28]] [[dashboard-canli-liste-aboneliksiz-2026-07-28]]
[[account-restricted-otomatik-tespit-2026-07-23]]
