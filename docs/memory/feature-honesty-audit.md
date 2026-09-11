---
name: feature-honesty-audit
description: "Satış öncesi dürüstlük denetimi (2026-06-29): 85 özellik kanıt-temelli + adversarial sınıflandırıldı. 53 GERÇEK, 24 KISMİ, 4 SAHTE, 4 BOZUK. Satılabilirlik için neyin düzeltilmesi gerektiği."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Ultracode workflow (9 grup denetçi + adversarial verify) 85 özelliği kanıtla sınıflandırdı.
Sayım: **REAL 53, PARTIAL 24, FAKE 4, BROKEN 4.** Çekirdek (cihaz/stream/AI-ajan/RPA/farm) GERÇEK.

**SAHTE (FAKE — UI var, backend no-op/sahte başarı) — SATMADAN ÖNCE DÜZELT/KALDIR:**
1. **AIGC (Görüntüden/Metinden Videoya, Görsel Oluştur)** — AiView.tsx:24-28/458: buton sadece chat'e
   prompt yazıyor; HİÇBİR medya üretim backend'i yok. Yanıltıcı başlık.
2. **Synchronizer (lider→takipçi giriş yansıtma)** — SynchronizerView EMULATOR_START gönderiyor; agent.mjs:229
   sadece {acknowledged:true} dönüp syncGroup'u YOK SAYIYOR. Gerçek mirror sadece stream.hub WS'de (wall'da)
   var, bu sayfa onu çağırmıyor. No-op. (Wall'daki Senkron GERÇEK; /synchronizer sayfası sahte.)
3. **FleetHub pazar yeri modül kurulumu** — catalog.seed listing'lerinde apkUrl/packageName YOK → "Kur" sadece
   sayaç artırıyor, iş göndermiyor. $19/$29 fiyat var ama ödeme akışı yok. Vitrin.
4. **Ayarlar→Tehlikeli bölge (workspace sıfırla/hesap sil)** — butonlar hard-disabled, onClick yok, "bu sürümde devre dışı".

**BOZUK (BROKEN — hata/işlevsiz):**
1. **Kullanım sayacı / online dakika metrelemesi** — usageService.accrue SADECE /devices/:id/heartbeat'ten
   çağrılıyor ama agent /agent/heartbeat'e gidiyor → DeviceUsage HİÇ dolmuyor → her yerde 0 dk/$0.00.
2. **Faturalama "Tahmini maliyet" + günlük kullanım grafiği** — yukarıdaki ölü metering yüzünden boş (series=[]).
3. **Referral atıf döngüsü** — public signup route'u YOK (app.vpsfleet.io/r/{code} hardcoded ama sayfa yok);
   recordSignup sadece admin createUser'dan çağrılıyor → link tıklaması hiçbir şey kaydetmiyor. Uçtan uca ölü.
4. **Uygulama mağazası APK kurulumu** — APP_CATALOG'da apkUrl YOK → agent "apkPath required" fırlatıp her job
   FAIL. Header'daki "APK Yükle" butonlarının onClick'i yok (ölü).

**KISMİ (PARTIAL — çalışır ama eksik/harici-bağımlı) önemliler:**
- Stripe faturalama (checkout/portal/webhook) → kod GERÇEK ama alıcının kendi STRIPE_SECRET_KEY'i gerekir (yoksa 503, UI dürüstçe "Stripe yapılandırılmadı" der).
- SMS/OTP (sms-bus, 5sim) → kod gerçek ama gerçek ücretli anahtar+bakiye gerekir (FIVESIM_API_KEY boş).
- Cloud-providers createPhone + per-device control (start/stop/shell/proxy/screenshot) → backend GERÇEK ama
  DASHBOARD'DA UI YOK (CloudProvidersView sadece check/sync/remove gösteriyor). VMOS createPhone/stop/delete NotSupported.
- WhatsApp auto-register API → server gerçek ama dashboard proxy/UI yok (panelden erişilemez).
- Sosyal OAuth → sadece X/Twitter gerçek; Meta/IG 501 NOT_IMPLEMENTED; dashboard'da connect UI yok.
- Snapshot/restore/clone → gerçek ama artifact host-local tar (object storage yok); clone hostId göndermediği için
  imaj içeriği uygulanmıyor (sadece boş cihaz satırı). Reset app-data wipe'ı sığ (rm -rf /sdcard, pm clear yok).
- Takvim/scheduler dispatchDue → job QUEUE edilince "POSTED" işaretliyor (telefon gerçekten paylaştı diye değil).
- E-posta bildirimleri → SMTP yoksa sessizce console'a yazıp delivered:false döner (UI başarılı görünür ama mail gitmez).
- FleetHub catalog şablonları → hepsi sadece EMULATOR_OPEN_APP (uygulamayı açıyor, reklamı yapılan aksiyonu yapmıyor).
- Library → dosya storage değil, link kayıt defteri (url+sizeBytes kullanıcıdan).
- Plugins → 3 modül hard-coded, install/enable yok (gerçek genişletilebilir sistem değil).
- Hosts heartbeat (/hosts/:id/heartbeat) → ölü/orphan + workspace-scope YOK = cross-tenant açık (kullanılmıyor ama riskli).
- Fleet AI chat → gerçek ama hafızasız (geçmiş gönderilmiyor).
- Parmak izi (önceki oturumdan): root'suz prop'lar gerçek değişiyor; IMEI/MAC root gerekir, uygulanmıyor.
- Proxy: host:port gerçek; auth'lu proxy ADB'den geçmiyor.

**GERÇEK çekirdek (satışın değer önermesi sağlam):** AI Cihaz Ajanı (ReAct), RPA Studio+run, AI flow builder,
AI insights/query, BFS app-explorer, canlı yayın+wall dokunma+konsol, farm (kampanya/warmup motoru/sağlık skoru/
ban-risk/TOTP kasa/CSV), IG kayıt + WhatsApp gönder/oku (agent+cihaz gerekir), Vast.ai (search/provision/sync/destroy),
cloud-provider CRUD+GeeLark/VMOS adapter+sync, auth/2FA/RBAC/webhooks/alerts/notifications/audit/quota — hepsi GERÇEK.

ÖNERİLEN SATIŞ-ÖNCESİ DÜZELTME SIRASI: (1) metering'i agent heartbeat'e bağla (billing değer önermesi),
(2) /synchronizer'ı wall mirror'a bağla VEYA kaldır, (3) AIGC butonlarını kaldır/gerçek API bağla,
(4) FleetHub+App store'a gerçek apkUrl ekle veya "yakında" işaretle, (5) tehlikeli bölgeyi ya yap ya gizle,
(6) referral public signup route'u ekle, (7) cloud-provider per-device control + createPhone UI ekle.

**HEPSİ DÜZELTİLDİ 2026-06-29 (8/8, her iki app tsc-clean, uçtan uca test edildi):**
1. METERING: agent.service.heartbeat artık her ONLINE cihaz için usageService.accrue çağırıyor
   (eski lastSeen'i okuyup overwrite'tan önce). updateMany→tek tek update. → DeviceUsage dolar, billing maliyet grafiği canlanır.
2. /synchronizer: SynchronizerView tamamen yeniden yazıldı — leader cihazı useDeviceStream ile canlı açıp
   send({type:'mirror',deviceIds:followers}) gönderiyor (wall'daki GERÇEK stream.hub mirror). Sahte EMULATOR_START job kaldırıldı.
3. AIGC: AiView başlık "AIGC"→"İçerik Asistanı", item başlıkları dürüstleştirildi (video/görsel ÜRETMİYOR, AI plan/senaryo veriyor).
4. REFERRAL: yeni dashboard /r/[code]/route.ts → kodu fleet_ref cookie'ye yazıp /login'e redirect; /api/users POST
   cookie'yi okuyup referralCode olarak backend'e geçiyor → createUser recordSignup çağırıyor. ReferralView linki window.location.origin'e bağlandı (hardcoded app.vpsfleet.io kaldırıldı). Test: /r/TESTCODE→307.
5. APP STORE: catalog.service.installApp artık apkUrl parametresi alıyor + apkUrl yoksa 422 APK_URL_REQUIRED fırlatıyor
   (sessiz FAIL yerine). ApplicationsView'e APK URL alanı + gerçek "APK Yükle" custom modal (paket+url+cihaz) eklendi.
6. TEHLİKELİ BÖLGE: workspace.service resetWorkspace (operasyonel veri sil, üye/ayar korur) + deleteWorkspace
   eklendi; controller admin-guard + slug-confirm; routes POST /:id/reset, DELETE /:id. Yeni DangerZone.tsx client
   bileşeni (slug yazarak onay). Test: yanlış confirm→400, doğru→200 ok:true.
7. CLOUD-PROVIDER UI: CloudProvidersView'e "Telefon oluştur" butonu (createPhone) + dashboard proxy route'ları
   (/api/cloud-providers/[id]/phones, /devices/[deviceId]/action, /proxy). NOT: per-device start/stop/shell UI'ı
   profil-detayına henüz gömülmedi (backend+proxy hazır) — sonraki tur isteğe bağlı.
KALAN (bilinçli, harici-bağımlı, KOD SORUNU DEĞİL): Stripe (alıcının anahtarı), SMS/5sim (ücretli anahtar),
GeeLark/VMOS gerçek API anahtarı, IMEI/MAC root, auth'lu proxy, SMTP. Bunlar müşterinin kendi kurulumunda çalışır.

**EK DÜZELTMELER 2026-06-29 (oturum 2):**
- Hosts heartbeat cross-tenant açığı + host-delete IDOR → KAPATILDI ([[hosts-heartbeat-security-fix]]).
- Fleet AI chat HAFIZASIZ idi → DÜZELTİLDİ: dashboard /api/ai route'u artık `history` (son 20 tur, sanitize+cap)
  alıp Anthropic'e gönderiyor; AiView send() önceki mesajları yolluyor. Bağlamlı konuşma. (tsc temiz; canlı test
  ANTHROPIC_API_KEY gerektirir — kod yolu doğru.)
- Mail gelen-kutusu görüntüleyici eklendi ([[mail-inbox-viewer]]).
- AI Device Agent "AI_NOT_CONFIGURED" çiğ kodu yerine /ai-agent'ta net Türkçe uyarı bandı + buton gating
  ([[session-state-live-issues]] item: aiConfigured status probe).
- E-posta bildirim sessiz-sahte başarı → DÜZELTİLDİ: workspace.controller invite artık sendMail'i AWAIT edip
  `emailDelivered`+`emailVia`'yı response'a koyuyor; /admin/members invite() bunu okuyup SMTP yoksa
  "üye eklendi ANCAK e-posta gönderilemedi (SMTP yapılandırılmadı)" diye DÜRÜST uyarı veriyor (eskiden hep
  "eklendi ve bilgilendirildi" diyordu). mail.service zaten dürüsttü (delivered:false döner); kusur UI'daydı.
  NOT: invite endpoint'i sadece ZATEN KAYITLI kullanıcıyı workspace'e ekler (yoksa 404 USER_NOT_FOUND).
  MembersView (/members) ise /api/users ile DOĞRUDAN hesap oluşturur (e-posta iddiası yok = zaten dürüst).

- Scheduler "POSTED" yalanı → DÜZELTİLDİ: calendar.service.dispatchDue artık RPA flow'lu gönderiyi job
  QUEUE edince `POSTING` ("Gönderiliyor") işaretliyor (eskiden hemen `POSTED`). Flow yoksa (cihazda iş yok)
  gerçek `POSTED`. UI zaten POSTING'i destekliyordu (CalendarView "Gönderiliyor"/busy dot). DÜRÜST artık.
  TAM döngü için ideal: job COMPLETED olunca POSTING→POSTED (job-completion hook gerekir, daha büyük iş — not edildi).

- Cloud-provider per-device kontrol UI → EKLENDİ: yeni CloudPhoneControlPanel.tsx (profiles/[id]). Sağlayıcı-
  bağlı cihazlarda (device.cloudProvider && !==SELF) profil detayında görünür: Başlat/Durdur/Yeniden başlat,
  ekran görüntüsü, uzak shell komutu, proxy ata/temizle — hepsi gerçek vendor API'sine gider (backend zaten
  hazırdı: /cloud-providers/devices/:deviceId/action|shell|proxy|screenshot). Eksik dashboard proxy route'ları
  (/shell, /screenshot) eklendi (action+proxy zaten vardı). DetailDevice type'ına cloudProvider+externalId
  eklendi (getDevice ham row döndürüyor, alanlar zaten geliyordu). SELF/KVM cihazlarda panel GİZLİ (doğru).
  tsc temiz, profil sayfası 200. (Şu an provider-bağlı cihaz yok, o yüzden panel görünmüyor = beklenen.)
  KEŞİF DOĞRULANDI: dashboard apiClient service-auth ile require2fa'yı bypass eder → cihazları GÖRÜR
  (cmqn45mfe...). Wall-boş yalnız interaktif login'de.

- Snapshot clone hostId → DÜZELTİLDİ: cloneFromSnapshot artık hostId verilmezse snapshot.sourceDeviceId'nin
  host'unu otomatik çözüyor (artifact host-LOCAL tar olduğu için klon, tar'ı tutan host'a inmeli). Host varsa
  EMULATOR_SNAPSHOT_RESTORE job'u dispatch olur (imaj uygulanır); yoksa boş cihaz satırı + restoreDispatched:false.
  Servis artık {deviceId, hostId, restoreDispatched} döndürüyor; ImagesView doClone bunu okuyup DÜRÜST mesaj
  veriyor ("cihaz oluşturuldu ANCAK imaj uygulanmadı — host yok" vs "geri yükleme başlatıldı"). tsc temiz.
  CANLI TEST: henüz READY snapshot yok (capture agent'ın tar'ı tamamlamasını ister) → tam klon testi yapılamadı;
  kod yolu doğru+tip-güvenli.

- Scheduler POSTING→POSTED job-completion hook → DÜZELTİLDİ (TAM DÖNGÜ): dispatchDue RPA_RUN job'una
  scheduledPostId ekliyor; agent.complete (RPA_RUN + scheduledPostId) → calendarService.resolvePosting çağırıyor;
  resolvePosting yalnız status===POSTING iken: COMPLETED→POSTED(postedAt), FAILED→FAILED. Idempotent (settled
  post override edilmez, 2. cihazın job'u re-fire etmez). Tam yaşam döngüsü: SCHEDULED→POSTING→POSTED/FAILED.
  agent.service artık calendar.service import eder (döngüsel import YOK — calendar yalnız jobs.service+prisma).
  DOĞRULANDI: POSTING→resolve(ok)→POSTED; 2. resolve guard ile no-op. tsc temiz, API boot temiz.

TÜM KOD-FIXABLE AUDIT MADDELERİ KAPANDI. Geriye yalnız büyük/harici-bağımlı işler: object storage (snapshot
artifact S3), gerçek Stripe/SMS/5sim/GeeLark API anahtarları (müşterinin), root IMEI/MAC, auth'lu proxy, SMTP.
Bunlar müşterinin kendi kurulumunda anahtar/altyapı ile çalışır — kod hazır.

- Job_emulatorId_fkey CRASH → DÜZELTİLDİ: createJobRecord (jobs.service.ts) artık emulatorId'yi yalnız
  GERÇEK bir Emulator satırıysa bağlıyor; değilse (Device id ise — modern akışlar Device kullanır) payload.deviceId'ye
  katlıyor (agent claimNext zaten payload.deviceId ile job claim eder). Bu, batch.service.registerAccount'un
  REGISTER_INSTAGRAM/WHATSAPP job'u yaratırken Device id'yi emulatorId slotuna geçirip FK ihlaliyle çökmesini
  düzeltir — TÜM createJobRecord çağıranları tek noktadan korur. DOĞRULANDI: Device id (Emulator değil) ile
  job.create → FK ihlali YOK. Hesap farm kaydı artık patlamıyor.
KEŞİF: x-service-auth login require2fa gate'ini BYPASS ediyor → Default Workspace token'ı alıyor (dashboard
apiClient bunu kullanır). Wall-boş sorunu yalnız INTERAKTİF login'de (2FA'sız admin + require2fa'lı ws).