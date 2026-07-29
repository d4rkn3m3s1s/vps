'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Search, Copy, Check, KeyRound, ChevronRight, Rocket, Loader2, Terminal, AlertTriangle } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, Reveal } from '../../components/hud';

// Method → colour class (defined in globals.css: .api-m-get etc.)
type Method = 'GET' | 'POST';
// Bir ucun ÇALIŞMASI için cihazın hangi durumda olması gerektiği. API'deki guard'ın
// (apps/api/src/modules/devices/whatsappCategory.ts) karşılığı — uymayan çağrı 409 alır.
type Requires = 'any' | 'wa' | 'wa-read' | 'empty';
type Endpoint = {
  method: Method;
  path: string;
  title: string;
  desc: string;
  body?: string; // örnek JSON gövde (POST için)
  legacy?: string; // eski yol — hâlâ çalışır, yeni entegrasyonlarda kullanmayın
  requires?: Requires; // grubunkinden farklıysa
};
type Group = { title: string; requires: Requires; endpoints: Endpoint[] };

// Cihaz kategorileri — /public/v1/devices cevabındaki `whatsappCategory` alanı.
const CATEGORIES: Array<{ key: string; label: string; desc: string; color: string }> = [
  { key: 'empty', label: 'empty — boş', desc: 'WhatsApp hesabı yok. Sadece kurulum + kayıt uçları çalışır.', color: '#94a3b8' },
  { key: 'registering', label: 'registering — kayıt sürüyor', desc: 'Kayıt tamamlanmadı. WhatsApp uçları henüz çalışmaz.', color: '#fbbf24' },
  { key: 'whatsapp', label: 'whatsapp — hazır', desc: 'Kullanılabilir hesap (ACTIVE / KISITLI). Tüm uçlar çalışır.', color: '#4ade80' },
  { key: 'manual', label: 'manual — elle kayıtlı', desc: 'Cihaz korumalı ve hesap elle kaydedilmiş; panelde numara kaydı yok ama uçlar çalışır.', color: '#60a5fa' },
  { key: 'blocked', label: 'blocked — ölü hesap', desc: 'YASAKLI / ÇIKIŞ YAPMIŞ. Okuma uçları çalışır, gönderim 409 verir.', color: '#f87171' }
];

const REQUIRES_BADGE: Record<Requires, { text: string; color: string; title: string }> = {
  any: { text: 'her cihaz', color: '#94a3b8', title: 'Cihazın WhatsApp durumu aranmaz.' },
  wa: { text: 'WhatsApp hazır', color: '#4ade80', title: 'Kullanılabilir hesap gerekir (whatsapp / manual). Boş, kayıt-süren, yasaklı veya çıkış-yapmış cihazda 409 döner.' },
  'wa-read': { text: 'hesap gerekir (okuma)', color: '#38bdf8', title: 'Hesap gerekir ama YASAKLI/ÇIKIŞ-YAPMIŞ cihazda da çalışır (veri cihazda durur) — cevaba accountWarning eklenir.' },
  empty: { text: 'boş cihaz', color: '#c084fc', title: 'Boş veya yeniden kaydedilecek cihaz içindir.' }
};

// The full public API surface, grouped the same way as the Postman collection.
// Kept in sync with apps/api/src/modules/public/public.routes.ts.
const GROUPS: Group[] = [
  {
    title: 'Hesap & Cihazlar',
    requires: 'any',
    endpoints: [
      { method: 'GET', path: '/public/v1/me', title: 'Kimlik + filo özeti', desc: 'Bu API anahtarının workspace’i, scope’ları, cihaz sayısı ve `devices` altında kategori dağılımı: kaç boş, kaç WhatsApp hazır, kaç yasaklı — listeyi çekmeden.' },
      { method: 'GET', path: '/public/v1/devices?category=whatsapp', title: 'Cihazları listele (filtreli)', desc: 'Her cihaz: id, name, status, whatsappCategory (empty | registering | whatsapp | manual | blocked), whatsappNumber, whatsappHealth, whatsappReady, tags. FİLTRELER: ?category= · ?whatsappReady=true · ?status=ONLINE · ?tag=test · ?search=isim. Cevaptaki meta.counts filonun TAMAMINDAKİ dağılımı verir (filtreden bağımsız).' },
      { method: 'GET', path: '/public/v1/devices/:id', title: 'Cihaz detayı + YETENEKLER', desc: '★Tek cihaz + capabilities: bu cihazda hangi endpoint grupları ÇALIŞIR (available[]) ve çalışmayanlar NEDEN çalışmaz (unavailable[] — her biri {group, code, reason}). Bir uca istek atmadan önce buraya bakarak 409 yemekten kurtulursunuz.' },
      { method: 'POST', path: '/public/v1/devices/:id/rename', title: 'Cihaz adını değiştir', desc: 'Cihazın adını (görünen etiket) değiştirir. Kozmetik — instance / WhatsApp hesabı / proxy etkilenmez. Döner: {id, name, status}.', body: '{\n  "name": "yeni-cihaz-adi"\n}' },
      { method: 'POST', path: '/public/v1/devices/:id/tags', title: 'Cihaza etiket ekle/çıkar', desc: 'Cihaza etiket ekle/çıkar/değiştir. mode: add (varsayılan) | remove | set. "#test" → "test" (baştaki # atılır, küçük harfe çevrilir).', body: '{\n  "tags": ["#test"],\n  "mode": "add"\n}' }
    ]
  },
  {
    title: 'WhatsApp — Gönderim',
    requires: 'wa',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/send/text', legacy: '/public/v1/whatsapp/send', title: 'Mesaj gönder', desc: 'Bir cihazdan WhatsApp mesajı gönderir. jobId döner. Cihazda hesap yoksa 409 NO_WHATSAPP_ACCOUNT, hesap YASAKLI/ÇIKIŞ-YAPMIŞ ise 409 ACCOUNT_BANNED / ACCOUNT_LOGGED_OUT — iş kuyruğa bile girmez. Idempotency-Key header’ı ile çift-gönderim önlenir.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "message": "Merhaba, test mesajı."\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/send/bulk', title: 'Toplu gönder', requires: 'any', desc: 'Tek çağrıda çok sayıda FARKLI mesaj (en fazla 100). Her biri için {to, jobId, status} döner. Gövde çok cihazlı olabildiği için ön-kontrol mesaj bazında yapılır — uygun olmayan cihazın mesajı kendi hatasını döndürür.', body: '{\n  "messages": [\n    { "deviceId": "CIHAZ_ID", "to": "905400403800", "message": "Mesaj 1" },\n    { "deviceId": "CIHAZ_ID", "to": "905400403801", "message": "Mesaj 2" }\n  ]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/send/broadcast', legacy: '/public/v1/whatsapp/broadcast', title: 'Yayın / broadcast', desc: 'Aynı mesajı çok kişiye (throttle’lı). peers[] VEYA labelId gerekli. {broadcastId, queued} döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "message": "Herkese duyuru.",\n  "peers": ["905400403800", "905400403801"]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/send/media', legacy: '/public/v1/whatsapp/send-media', title: 'Medya gönder', desc: 'Bir kişiye resim/belge gönderir. kind: image | document.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "mediaUrl": "https://ornek.com/resim.jpg",\n  "caption": "Açıklama",\n  "kind": "image"\n}' }
    ]
  },
  {
    title: 'WhatsApp — Sohbetler & Etiketler',
    requires: 'wa-read',
    endpoints: [
      { method: 'GET', path: '/public/v1/whatsapp/chats?deviceId=&limit=50', legacy: '/public/v1/whatsapp/conversations', title: 'Sohbet listesi', desc: 'WhatsApp-Web tarzı sohbet listesi (kişi başına son mesaj + okunmamış). filter: all | unread | favorite | archived.' },
      { method: 'GET', path: '/public/v1/whatsapp/chats/thread?deviceId=&peer=&limit=50', legacy: '/public/v1/whatsapp/thread', title: 'Sohbet geçmişi', desc: 'Bir sohbetin mesaj geçmişi (eski→yeni), yukarı kaydırma sayfalaması.' },
      { method: 'GET', path: '/public/v1/whatsapp/chats/messages?deviceId=&limit=100', legacy: '/public/v1/whatsapp/messages', title: 'Mesajları oku', desc: 'Kaydedilmiş konuşma geçmişi (gelen+giden). direction: IN | OUT (opsiyonel).' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/read', legacy: '/public/v1/whatsapp/thread/read', title: 'Sohbeti okundu işaretle', desc: 'Bir sohbetin okunmamış rozetini sıfırlar.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/clear', legacy: '/public/v1/whatsapp/clear-chat', title: 'Sohbeti temizle', desc: 'Bir sohbetteki tüm yerel mesajları temizler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/summary', legacy: '/public/v1/whatsapp/chat-summary', title: 'Sohbet özeti', desc: 'Bir sohbetin toplam/gelen/giden/medya sayıları + ilk-son mesaj zamanı. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/delete-message', legacy: '/public/v1/whatsapp/delete-message', title: 'Mesaj sil', desc: 'Bir mesajı siler. scope: me (bende) | everyone (herkesten). matchText ile eşleşen mesajı hedefler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "scope": "everyone",\n  "matchText": "silinecek metin"\n}' },
      { method: 'GET', path: '/public/v1/whatsapp/chats/stats?deviceId=&sinceHours=24', legacy: '/public/v1/whatsapp/stats', requires: 'any', title: 'İstatistik', desc: 'Mesaj sayıları + SLA. deviceId opsiyoneldir — verilmezse tüm workspace özetlenir (o durumda cihaz kontrolü uygulanmaz).' },
      { method: 'GET', path: '/public/v1/whatsapp/labels', requires: 'any', title: 'Etiketleri listele', desc: 'Workspace’in sohbet kategorileri (etiketleri). Cihaza bağlı değildir.' },
      { method: 'POST', path: '/public/v1/whatsapp/labels', requires: 'any', title: 'Etiket oluştur', desc: 'Yeni bir sohbet kategorisi (etiket) oluşturur, örn "#test". Dönen id ile sohbetlere atayabilirsiniz.', body: '{\n  "name": "#test",\n  "color": "#e11d48"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/labels', legacy: '/public/v1/whatsapp/conversations/labels', title: 'Sohbete etiket ata', desc: 'Bir sohbete kategori (etiket) atar. labelIds, POST /labels’ten dönen id’ler.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800",\n  "labelIds": ["ETIKET_ID"]\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/chats/state', legacy: '/public/v1/whatsapp/conversations/state', title: 'Sohbet durumu', desc: 'Sohbeti favori / arşiv / sabitle olarak işaretler.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "peer": "905400403800",\n  "favorite": true,\n  "archived": false,\n  "pinned": false\n}' }
    ]
  },
  {
    title: 'WhatsApp — Kişiler',
    requires: 'wa-read',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/contacts/list', legacy: '/public/v1/whatsapp/contacts', title: 'Kişileri listele', desc: 'Hesabın rehberi (numara + isim). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 200\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/contacts/profile', legacy: '/public/v1/whatsapp/profile', title: 'Profil getir', desc: 'Kişinin avatar + ismini çeker. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/contacts/block', legacy: '/public/v1/whatsapp/block', title: 'Engelle / engel kaldır', desc: 'Kişiyi engeller/engeli kaldırır (block, varsayılan true).', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "block": true\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/contacts/blocklist', legacy: '/public/v1/whatsapp/blocklist', title: 'Engellenenler listesi', desc: 'Cihazın engellenen kişiler listesi. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/contacts/group-members', legacy: '/public/v1/whatsapp/group-members', title: 'Grup üyeleri', desc: 'Bir grubun üyeleri (numara + admin). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "group": "Grup adı veya jid",\n  "limit": 200\n}' }
    ]
  },
  {
    title: 'WhatsApp — Kendi hesabım',
    requires: 'wa',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/account/health', legacy: '/public/v1/whatsapp/account-health', requires: 'any', title: 'Hesap sağlığı (her cihazda çalışır)', desc: '★Cihaz hesabının GERÇEK durumu — kayıtlı numara, WA sürümü, kayıt durumu; doğrudan cihazdan okunur. Bilerek kontrolsüzdür: panelde hesap kaydı görünmeyen (elle kaydedilmiş) bir cihazda bile çalışır, yani "hesabım var ama API boş diyor" durumunun çıkış yoludur. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/account/number', legacy: '/public/v1/whatsapp/mynumber', requires: 'any', title: 'Kendi numaram (her cihazda çalışır)', desc: 'Cihazdaki hesabın kendi numarasını CİHAZDAN okur. Sağlık ucu gibi kontrolsüzdür. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/account/name', legacy: '/public/v1/whatsapp/profile/name', title: 'Kendi profil ismini değiştir', desc: 'Cihazın KENDİ WhatsApp profil ismini (görünen ad) değiştirir. Maks 25 karakter. jobId döner — sonucu Görev geçmişinden izleyin.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "name": "Zara Destek"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/account/avatar', legacy: '/public/v1/whatsapp/profile/avatar', title: 'Kendi profil resmini değiştir', desc: 'Cihazın KENDİ WhatsApp profil resmini değiştirir. imageB64 = base64 PNG/JPEG (data-URI ön eki de kabul edilir, maks ~8MB). Kare resim önerilir. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "imageB64": "iVBORw0KGgo..."\n}' }
    ]
  },
  {
    title: 'WhatsApp — Veri okuma (root-DB)',
    requires: 'wa-read',
    endpoints: [
      { method: 'POST', path: '/public/v1/whatsapp/data/receipts', legacy: '/public/v1/whatsapp/receipts', title: 'Teslim / okundu', desc: 'Bir sohbetteki mesajların teslim/okundu bilgisi (✓/✓✓/mavi), msgstore.db’den. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/unread', legacy: '/public/v1/whatsapp/unread', title: 'Okunmamışlar', desc: 'Okunmamış mesajı olan her sohbet + sayısı. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/search', legacy: '/public/v1/whatsapp/search', title: 'Ara / arama', desc: 'Hesabın TÜM mesajlarında tam-metin arama (FTS). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "query": "merhaba",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/media', legacy: '/public/v1/whatsapp/media', title: 'Medya listesi', desc: 'Sohbetteki (veya tüm) medya galerisi. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/fetch-media', legacy: '/public/v1/whatsapp/fetch-media', title: 'Medya indir (base64)', desc: 'İndirilmiş medyayı base64 olarak çeker. İndirilmemişse pending:true döner (cihazda şifreli blob var). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 10\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/calls', legacy: '/public/v1/whatsapp/calls', title: 'Arama kaydı', desc: 'Hesabın WhatsApp arama kaydı (sesli/görüntülü, gelen/giden/cevapsız). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/deleted', legacy: '/public/v1/whatsapp/deleted', title: 'Silinen mesajlar', desc: 'Karşı tarafın "herkesten sil" ile sildiği ama DB’de kalan mesajlar (anti-delete). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/links', legacy: '/public/v1/whatsapp/links', title: 'Paylaşılan linkler', desc: 'Sohbetlerde paylaşılan URL’ler. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/reactions', legacy: '/public/v1/whatsapp/reactions', title: 'Emoji tepkileri', desc: 'Mesajlara verilen emoji tepkileri (isteğe bağlı tek sohbet). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/polls', legacy: '/public/v1/whatsapp/polls', title: 'Anketler', desc: 'Anketler (soru + seçenekler + oy sayıları). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 50\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/read-by', legacy: '/public/v1/whatsapp/read-by', title: 'Kim okudu (read-by)', desc: 'Gönderdiğiniz mesajları kimin okuduğu (grupta hangi üyeler okudu). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/starred', legacy: '/public/v1/whatsapp/starred', title: 'Yıldızlı mesajlar', desc: 'Hesabın yıldızladığı (kaydettiği) mesajlar. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 100\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/labels-list', legacy: '/public/v1/whatsapp/labels-list', title: 'İş etiketleri (Business)', desc: 'WhatsApp Business etiketleri (isim/renk/sohbet sayısı). Sohbet kategorilerinden (/labels) ayrıdır. jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/view-once', legacy: '/public/v1/whatsapp/view-once', title: 'Tek görünümlük medya', desc: 'Tek-görünümlük (view-once) medyayı base64 çeker (root, UI açılmış saysa bile görür). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "limit": 20\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/data/voice-notes', legacy: '/public/v1/whatsapp/voice-notes', title: 'Sesli notlar (PTT)', desc: 'Hesabın sesli notları. withAudio:false sadece meta (daha hızlı). jobId döner.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "to": "905400403800",\n  "limit": 20,\n  "withAudio": false\n}' }
    ]
  },
  {
    title: 'Cihaz Kurma & WA Kayıt',
    requires: 'empty',
    endpoints: [
      { method: 'POST', path: '/public/v1/devices/provision', title: 'Cihaz kur (tek)', desc: 'Sıfırdan yeni bir cloud phone kurar (boot→root→kimlik→proxy→app→WA-hazır). {deviceId, jobId} döner. proxyCountry = numara alacağınız ülke (ISO-2). Üstteki "Canlı Dene" kutusuyla deneyebilirsiniz.', body: '{\n  "name": "yeni-cihaz",\n  "proxyCountry": "tr"\n}' },
      { method: 'POST', path: '/public/v1/devices/provision/batch', title: 'Cihaz kur (toplu, 1–20)', desc: 'Tek çağrıda çok cihaz kurar. count = adet (1–20), namePrefix = isim öneki (watest → watest-a3f…), proxyCountry = ülke. Hataya dayanıklı: host dolarsa başlayanlar started[] içinde, başarısızlar failed[] içinde döner. Her başlayan cihazın kendi {jobId, deviceId}’si vardır — durumu tek tek izleyin.', body: '{\n  "count": 3,\n  "namePrefix": "watest",\n  "proxyCountry": "tr"\n}' },
      { method: 'GET', path: '/public/v1/devices/provision/:jobId/status', title: 'Kurulum durumu (canlı)', desc: 'Kurulumun canlı ilerlemesi: phase (provisioning | ready | failed), percent, adım-adım log[] (her satır: adım + not + zaman), lastProgress ve başarısızsa error (hata sebebi). Poll edip panel modalı gibi canlı izleyin.' },
      { method: 'POST', path: '/public/v1/whatsapp/register', title: '1) WA kayıt başlat', desc: 'Kendi numaranızla otonom WhatsApp kaydı başlatır. Ajan SMS-kod ekranına kadar sürer ve DURUR (AWAITING_OTP). accountId döner — bunu status ve otp çağrılarında kullanın.', body: '{\n  "deviceId": "CIHAZ_ID",\n  "phoneNumber": "905XXXXXXXXX"\n}' },
      { method: 'GET', path: '/public/v1/whatsapp/register/:id/status', title: '2) Kayıt durumu (poll → "kodu gir" der)', desc: 'Kaydın CANLI durumu. Poll edin: awaitingOtp:true olunca API "SMS kodunu gir" diyor (→ adım 3). awaitingMethod:true (otpChannel:method_select) olursa önce yöntem seçin (→ adım 2b). Alanlar: status, otpChannel (sms|other_phone|method_select|rate_limited), awaitingOtp, awaitingMethod, note (Türkçe açıklama), percent, log[].' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/verify-method', title: '2b) Doğrulama yöntemi seç (modal gelirse)', desc: 'WhatsApp "nasıl doğrulansın" modalı geldiğinde (status awaitingMethod:true) yöntem seçer: sms | voice | missed_call. Ajan uygular, SMS adımına devam eder.', body: '{\n  "method": "sms"\n}' },
      { method: 'POST', path: '/public/v1/whatsapp/register/:id/otp', title: '3) OTP / SMS kodunu gir', desc: 'status awaitingOtp:true iken SMS kodunu buradan girin. Ajan kodu girer + profili tamamlar → hesap ACTIVE (veya kod yanlışsa tekrar AWAITING_OTP / FAILED). Çift-gönderime karşı korumalı.', body: '{\n  "otpCode": "123456"\n}' }
    ]
  },
  {
    title: 'İşler (Job sonucu)',
    requires: 'any',
    endpoints: [
      { method: 'GET', path: '/public/v1/jobs/:jobId', title: 'Job sonucu', desc: 'Herhangi bir on-device işlemin sonucu. Cevap: status + result + ok (gerçekten başarılı mı?) + retryable (tekrar denemeye değer mi?) + warning (okunabilir Türkçe sebep, örn "Hesap KISITLI — yeni sohbet başlatamıyor").' },
      { method: 'GET', path: '/public/v1/jobs/:jobId/wait?timeout=30', title: 'Job sonucu — bekle (long-poll)', desc: 'İş bitene (veya timeout saniyesine) kadar bekler, sonucu TEK istekte döndürür. Poll döngüsü yerine bunu kullanın. Aynı ok/retryable/warning alanları gelir.' }
    ]
  }
];

const TOTAL = GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="api-copy"
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
      title="Kopyala"
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ── Canlı "Tek Tık Cihaz Oluştur" denemesi (GERÇEK PUBLIC API) ──────────────
// Panelin provision modalının API karşılığı — ama gerçek public uçlara, entegratörün
// yaşayacağı şekilde: kendi flk_ anahtarını gir → POST /public/v1/devices/provision
// (veya /provision/batch) çağrılır → her jobId'nin GET /provision/:id/status'ü poll
// edilerek canlı log + yüzde + hata gösterilir. x-api-key ile gider (BFF/JWT DEĞİL),
// yani tam olarak harici bir istemcinin gördüğü akış. Anahtar sadece tarayıcıda kalır.
type ProgressLine = { ts: string; step: string; note?: string; status: string };
type LiveJob = { jobId: string; deviceId: string; name: string; percent: number; phase: string; status: string; log: ProgressLine[]; error: string | null };

function lineColor(note?: string, status?: string): string {
  if (status === 'FAILED' || (note ?? '').startsWith('❌')) return '#f87171';
  if ((note ?? '').startsWith('✓')) return '#4ade80';
  if ((note ?? '').startsWith('⚠')) return '#fbbf24';
  return '#94a3b8';
}

function ProvisionTryIt({ baseUrl }: { baseUrl: string }) {
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const [proxyCountry, setProxyCountry] = useState('tr');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const keyRef = useRef(apiKey);
  keyRef.current = apiKey;

  // Poll every started job's status via the REAL public status endpoint (x-api-key)
  // until all are terminal (ready/failed).
  useEffect(() => {
    if (!jobs.length) return;
    const allDone = jobs.every((j) => j.phase === 'ready' || j.phase === 'failed');
    if (allDone) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      const updated = await Promise.all(jobs.map(async (j) => {
        if (j.phase === 'ready' || j.phase === 'failed') return j;
        try {
          const res = await fetch(`${baseUrl}/public/v1/devices/provision/${j.jobId}/status`, { headers: { 'x-api-key': keyRef.current } });
          const d = (await res.json())?.data;
          if (!d) return j;
          return { ...j, percent: d.percent ?? j.percent, phase: d.phase ?? j.phase, status: d.status ?? j.status, log: Array.isArray(d.log) ? d.log : j.log, error: d.error ?? null };
        } catch { return j; }
      }));
      setJobs(updated);
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, baseUrl]);

  async function launch() {
    if (busy) return;
    if (!apiKey.trim()) { setErr('Önce API anahtarınızı (flk_…) girin.'); return; }
    setBusy(true); setErr(null); setJobs([]);
    try {
      const single = count <= 1;
      const url = single ? `${baseUrl}/public/v1/devices/provision` : `${baseUrl}/public/v1/devices/provision/batch`;
      const body = single
        ? { ...(name.trim() ? { name: name.trim() } : {}), ...(proxyCountry ? { proxyCountry } : {}) }
        : { count, ...(name.trim() ? { namePrefix: name.trim() } : {}), ...(proxyCountry ? { proxyCountry } : {}) };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim() }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      const d = j?.data;
      if (!res.ok || !d) { setErr((j && (j.message || j.error)) || `Kurulum başlatılamadı (HTTP ${res.status})`); return; }
      const started: LiveJob[] = single
        ? [{ jobId: d.jobId, deviceId: d.deviceId, name: d.instance ?? name ?? 'cihaz', percent: 3, phase: 'provisioning', status: 'PENDING', log: [], error: null }]
        : (d.started ?? []).map((s: { jobId: string; deviceId: string; name: string }) => ({ jobId: s.jobId, deviceId: s.deviceId, name: s.name, percent: 3, phase: 'provisioning', status: 'PENDING', log: [], error: null }));
      if (!started.length) { setErr('Hiç cihaz başlatılamadı (host dolu olabilir).'); return; }
      setJobs(started);
    } catch {
      setErr('Ağ hatası — kurulum başlatılamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="api-try">
      <label className="api-try-key">API anahtarı (x-api-key)
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="flk_…" autoComplete="off" />
      </label>
      <div className="api-try-form">
        <label>İsim / önek<input value={name} onChange={(e) => setName(e.target.value)} placeholder="watest (boş = rastgele)" /></label>
        <label>Adet<input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
        <label>Proxy ülke<input value={proxyCountry} onChange={(e) => setProxyCountry(e.target.value.toLowerCase().slice(0, 2))} placeholder="tr" /></label>
        <button className="api-try-btn" onClick={launch} disabled={busy}>
          {busy ? <><Loader2 size={15} className="spin" /> Başlatılıyor…</> : <><Rocket size={15} /> {count > 1 ? `${count} cihaz kur` : 'Cihaz kur'}</>}
        </button>
      </div>
      {err && <p className="api-try-err"><AlertTriangle size={14} /> {err}</p>}
      {jobs.length > 0 && (
        <div className="api-try-jobs">
          {jobs.map((j) => {
            const done = j.phase === 'ready' || j.percent >= 100;
            const failed = j.phase === 'failed';
            const bar = failed ? '#ef4444' : done ? '#22c55e' : 'var(--accent)';
            return (
              <div className="api-try-job" key={j.jobId}>
                <div className="api-try-job-head">
                  <span className="api-try-job-name">{j.name}</span>
                  <span className="api-try-job-pct">{failed ? 'Başarısız' : done ? '✓ Hazır' : `%${j.percent}`}</span>
                </div>
                <span className="api-try-bar"><span className="api-try-bar-fill" style={{ width: `${Math.min(100, j.percent)}%`, background: bar }} /></span>
                <div className="api-try-term">
                  <div className="api-try-term-head"><Terminal size={12} /> Canlı kurulum günlüğü</div>
                  <div className="api-try-term-body">
                    {j.log.length === 0 ? <span style={{ opacity: 0.5 }}>Kuruluma başlanıyor…</span> : j.log.map((l, i) => (
                      <div key={i} style={{ color: lineColor(l.note, l.status) }}><span style={{ opacity: 0.45 }}>{l.step}▸ </span>{l.note ?? l.step}</div>
                    ))}
                    {!done && !failed && <div style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="spin" /> çalışıyor…</div>}
                    {failed && j.error && <div style={{ color: '#f87171', marginTop: 4 }}>❌ {j.error}</div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Bir ucun gerektirdiği cihaz durumunu gösteren küçük rozet.
function RequiresBadge({ requires }: { requires: Requires }) {
  const b = REQUIRES_BADGE[requires];
  return (
    <span
      title={b.title}
      style={{
        fontSize: '0.68rem', fontWeight: 600, letterSpacing: '.02em', whiteSpace: 'nowrap',
        padding: '.12rem .45rem', borderRadius: 999, color: b.color,
        border: `1px solid ${b.color}55`, background: `${b.color}12`
      }}
    >
      {b.text}
    </span>
  );
}

function EndpointCard({ ep, baseUrl, groupRequires }: { ep: Endpoint; baseUrl: string; groupRequires: Requires }) {
  const [open, setOpen] = useState(false);
  const fullUrl = `${baseUrl}${ep.path}`;
  const requires = ep.requires ?? groupRequires;
  const curl = ep.method === 'GET'
    ? `curl "${fullUrl}" \\\n  -H "x-api-key: FLK_ANAHTARINIZ"`
    : `curl -X POST "${fullUrl}" \\\n  -H "x-api-key: FLK_ANAHTARINIZ" \\\n  -H "Content-Type: application/json" \\\n  -d '${(ep.body ?? '{}').replace(/\n\s*/g, ' ')}'`;
  return (
    <div className={`api-ep ${open ? 'is-open' : ''}`}>
      <button className="api-ep-head" onClick={() => setOpen((v) => !v)}>
        <span className={`api-m api-m-${ep.method.toLowerCase()}`}>{ep.method}</span>
        <span className="api-ep-path">{ep.path}</span>
        <span className="api-ep-title">{ep.title}</span>
        {/* Grubunkinden FARKLI bir gereksinimi olan uçta rozet başlıkta da görünsün
            (örn. "her cihaz" olan account/health, WhatsApp gerektiren grup içinde). */}
        {ep.requires && ep.requires !== groupRequires && <RequiresBadge requires={ep.requires} />}
        <ChevronRight size={15} className="api-ep-chev" />
      </button>
      {open && (
        <div className="api-ep-body">
          <p className="api-ep-desc">{ep.desc}</p>
          <p style={{ fontSize: '.78rem', opacity: 0.75, margin: '.1rem 0 .6rem', display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Gereken cihaz:</span> <RequiresBadge requires={requires} />
          </p>
          {ep.legacy && (
            <p style={{ fontSize: '.78rem', opacity: 0.7, margin: '0 0 .6rem' }}>
              Eski yol (hâlâ çalışır, yeni entegrasyonlarda kullanmayın): <code>{ep.legacy}</code>
            </p>
          )}
          {ep.body && (
            <div className="api-code-block">
              <div className="api-code-head"><span>İstek gövdesi (JSON)</span><CopyBtn text={ep.body} /></div>
              <pre>{ep.body}</pre>
            </div>
          )}
          <div className="api-code-block">
            <div className="api-code-head"><span>cURL</span><CopyBtn text={curl} /></div>
            <pre>{curl}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApiDocsView() {
  const [q, setQ] = useState('');
  // The API is reachable at the same origin the dashboard is served from (Caddy
  // proxies /public/* to the API). Fall back to a placeholder during SSR.
  const [baseUrl] = useState<string>(() => (typeof window !== 'undefined' ? window.location.origin : 'https://alan-adiniz'));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return GROUPS;
    return GROUPS
      // Eski yollar da aranabilir olsun: entegratör elindeki legacy yolu yapıştırınca
      // yeni karşılığını bulabilmeli.
      .map((g) => ({ ...g, endpoints: g.endpoints.filter((e) => (e.path + ' ' + (e.legacy ?? '') + ' ' + e.title + ' ' + e.desc).toLowerCase().includes(s)) }))
      .filter((g) => g.endpoints.length > 0);
  }, [q]);

  return (
    <PageMotion>
      <HoloHeader
        eyebrow="GELİŞTİRİCİ"
        title="API Dokümantasyonu"
        subtitle={`WhatsApp Public API — ${TOTAL} uç nokta. x-api-key ile kimlik doğrulanır (JWT gerekmez).`}
      />

      <Reveal>
        <HoloPanel>
          <div className="api-intro">
            <div className="api-intro-text">
              <h3><KeyRound size={16} /> Başlarken</h3>
              <ol>
                <li><strong>Admin → API Anahtarları</strong>’ndan bir anahtar (<code>flk_…</code>) üretin.</li>
                <li>Her isteğe <code>x-api-key: flk_…</code> başlığını ekleyin.</li>
                <li>Kök adres: <code>{baseUrl}</code> — uçlar <code>/public/v1/…</code> altında.</li>
                <li>On-device işlemler (send, root-DB, kurulum, kayıt) hemen bir <code>jobId</code> döner; sonucu <code>/jobs/:id/wait</code> ile alın (<code>ok</code>, <code>retryable</code>, <code>warning</code> gelir).</li>
                <li>Her ucun <strong>gereken cihaz</strong> rozeti vardır — uymayan cihazda istek <code>409</code> alır. Bir cihazda nelerin çalıştığını <code>GET /public/v1/devices/:id</code> söyler.</li>
              </ol>
            </div>
            <a className="api-postman-btn" href="/fleet-whatsapp-api.postman_collection.json" download>
              <Download size={16} /> Postman koleksiyonunu indir
            </a>
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal>
        <HoloPanel title="Cihaz kategorileri — hangi uç hangi cihazda çalışır" icon={<AlertTriangle size={16} />}>
          <p className="api-try-intro">
            Her cihazın bir <code>whatsappCategory</code> değeri vardır (<code>GET /public/v1/devices</code> cevabında).
            Bir uç, gerektirdiği kategoriyi karşılamayan cihazda <strong>409</strong> döner — iş kuyruğa girmez,
            cihaz slotu boşa harcanmaz. <code>GET /public/v1/devices/:id</code> tek cihaz için
            hangi grupların çalıştığını (<code>capabilities</code>) doğrudan söyler.
          </p>
          <div style={{ display: 'grid', gap: '.5rem', padding: '0 .25rem .5rem' }}>
            {CATEGORIES.map((c) => (
              <div key={c.key} style={{ display: 'flex', gap: '.6rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '.72rem', fontWeight: 700, color: c.color, whiteSpace: 'nowrap',
                  border: `1px solid ${c.color}55`, background: `${c.color}12`, borderRadius: 999, padding: '.1rem .5rem'
                }}>{c.label}</span>
                <span style={{ fontSize: '.82rem', opacity: 0.8 }}>{c.desc}</span>
              </div>
            ))}
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal>
        <HoloPanel title="Tek Tık Cihaz Oluştur — Canlı Dene" icon={<Rocket size={16} />}>
          <p className="api-try-intro">
            Gerçek <code>POST /public/v1/devices/provision</code> çağrısı. İsim, adet ve proxy ülkesi girin;
            kurulum <strong>canlı</strong> olarak adım-adım günlük + yüzde ile ilerler (panel modalının API karşılığı).
            İstek <code>x-api-key</code> ile gider — anahtarınız yalnızca tarayıcıda kalır.
          </p>
          <ProvisionTryIt baseUrl={baseUrl} />
        </HoloPanel>
      </Reveal>

      <div className="api-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Uç nokta ara (örn. send, etiket, thread)…" />
      </div>

      {filtered.map((g) => (
        <Reveal key={g.title}>
          <HoloPanel>
            <h2 className="api-group-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              {g.title}
              <RequiresBadge requires={g.requires} />
            </h2>
            <div className="api-ep-list">
              {g.endpoints.map((ep) => <EndpointCard key={ep.method + ep.path} ep={ep} baseUrl={baseUrl} groupRequires={g.requires} />)}
            </div>
          </HoloPanel>
        </Reveal>
      ))}
      {filtered.length === 0 && <HoloPanel><p style={{ opacity: 0.6, padding: '1rem' }}>“{q}” için uç nokta bulunamadı.</p></HoloPanel>}
    </PageMotion>
  );
}
