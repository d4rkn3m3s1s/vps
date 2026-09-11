---
name: mail-inbox-viewer
description: "Hesap Üretici sayfasına (AccountsView) gelen-kutusu görüntüleyici eklendi 2026-06-29 — üretilen catchmail adresine gelen doğrulama maillerini panelden dinleyip okuma + OTP/link çıkarma."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Kullanıcı isteği: "mail üretince mailboxa mail geliyor mu onu dinleyip görmemiz lazım, ayrı bir yer."

DURUM ÖNCESİ: Backend TAM hazırdı — mail.provider.ts (listMessages/getMessage/extractCode/extractLink),
accounts.service mailInbox/mailMessage, API route'ları (/accounts/mail/messages, /message/:id), dashboard
proxy route'ları HEPSİ vardı. AccountsView SADECE inbox OLUŞTURUYORDU (adresi gösteriyordu) ama gelen
mesajları GÖRMENİN YOLU YOKTU. Eksik olan tek şey UI'dı.

EKLENEN (apps/dashboard/src/app/accounts/AccountsView.tsx):
- "Gelen Kutusu" HoloPanel (inbox oluşturulunca görünür). Mesaj listesi (en yeni üstte) + tıkla→tam mesaj.
- Tam mesaj görünümü: kimden/konu/tarih + ÇIKARILAN doğrulama kodu (kopyala butonlu, vurgulu) + doğrulama
  linki (tıklanabilir) + düz metin gövde. Backend mailMessage zaten {code, link} döndürüyor (extractCode/Link).
- Otomatik poll: inbox varken 5sn'de bir /api/accounts/mail/messages çeker (sekme gizliyse/mesaj açıkken durur)
  → yeni doğrulama maili elle yenilemeden görünür. "Yenile" butonu da var.
- makeInbox artık adresi set edince listeyi hemen yükler.

DOĞRULANDI (Windows API, internet AÇIK): inbox oluştu (claudetest18847@catchmail.io), /messages → 200 boş dizi
(catchmail erişilebilir, henüz mail yok = beklenen). /accounts sayfası 200. tsc temiz.

İLGİLİ: [[session-state-live-issues]] (catchmail artık Windows API ile bağlı). Gerçek doğrulama maili
ancak gerçek bir kayıt/signup yapılınca gelir; o zaman panelde otomatik belirir + OTP/link otomatik çıkarılır.
