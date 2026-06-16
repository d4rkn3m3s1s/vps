# Sunucu + Cloud Phone (Emulator) Kurulum Planı

Bu doküman, gerçek Android "cloud phone"ların çalışması için satın alman gereken
sunucuyu ve üzerine kurulacak emulator katmanını adım adım anlatır.

> ⚠️ **EN ÖNEMLİ KURAL:** Android emulator **nested virtualization (KVM)** gerektirir.
> KVM'siz hiçbir VPS'te emulator açılmaz. Sunucu almadan önce bu dokümanı oku.

---

## 1. Hangi sunucuyu almalı?

### ✅ Önerilen: Hetzner bare-metal (dedicated)
| Model | CPU | RAM | Disk | Fiyat (~) | Kaç emulator |
|-------|-----|-----|------|-----------|--------------|
| **AX42** | AMD Ryzen 7 PRO 8700GE (8c/16t) | 64 GB | 2×512 GB NVMe | ~€46/ay | ~5–10 |
| **AX52** | AMD Ryzen 7 7700 (8c/16t) | 64 GB | 2×1 TB NVMe | ~€54/ay | ~8–12 |
| **AX102** | AMD Ryzen 9 7950X3D (16c/32t) | 128 GB | 2×1.92 TB NVMe | ~€108/ay | ~15–25 |

- Hetzner bare-metal sunucularda `/dev/kvm` **vardır** ve nested virtualization açıktır.
- Başlangıç için **AX42 veya AX52** yeterli. Büyüyünce AX102'ye geç.
- Kurulum sırasında işletim sistemi olarak **Ubuntu 24.04 LTS** seç.

### ❌ ALMA (emulator açılmaz)
- Hetzner **Cloud** (CX/CPX) — paylaşımlı, nested virt yok
- OpenVZ / LXC tabanlı ucuz "VPS"ler
- Çoğu shared hosting

> Başka sağlayıcı (OVH, Contabo dedicated, vb.) de olur — **şartı tek:** `/dev/kvm` erişimi.
> Sunucu alırken satıcıya "nested virtualization / KVM passthrough destekliyor mu?" diye sor.

---

## 2. Emulator stratejisi — iki seçenek

### Seçenek A: `budtmo/docker-android` (basit, hızlı başlangıç)
- Hazır Docker imajı, içinde Android emulator + ADB + noVNC (tarayıcıdan ekran).
- Bu projenin `EMULATOR_IMAGE` ayarı zaten buna göre (`budtmo/docker-android-x86-11.0`).
- x86 Android imajı kullanır — performanslı ama bazı uygulamalar (ARM-only APK) çalışmayabilir.

### Seçenek B: Redroid (`redroid/redroid`) (gerçek cihaz hissi, ölçeklenebilir)
- Konteyner içinde gerçek Android (ARM translation destekli), daha hafif, daha çok telefon sığar.
- Host kernel'de bazı modüller gerekir (binder, ashmem).
- İleri seviye; Seçenek A çalıştıktan sonra buna geçilebilir.

**Önerim:** Önce Seçenek A ile 1 telefon çalıştır, akışı gör, sonra ölçek için B'yi değerlendir.

---

## 3. Sunucu kurulum adımları (Ubuntu 24.04)

Sunucuyu aldıktan sonra SSH ile bağlan ve sırayla çalıştır. (Komutları ben de
senin için çalıştırabilirim — sadece SSH erişimini ver.)

```bash
# 3.1 KVM gerçekten var mı? (çıktı boş DEĞİLse iyi)
egrep -c '(vmx|svm)' /proc/cpuinfo      # 0'dan büyük olmalı
ls -l /dev/kvm                          # dosya var olmalı

# 3.2 Docker kur
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 3.3 Tek bir test emulator başlat (budtmo)
docker run -d --name test-phone \
  --device /dev/kvm \
  -p 6080:6080 -p 5555:5555 \
  -e EMULATOR_DEVICE="Samsung Galaxy S10" \
  -e WEB_VNC=true \
  budtmo/docker-android:emulator_11.0

# 3.4 Tarayıcıdan ekranı gör
#   http://SUNUCU_IP:6080   → canlı Android ekranı
# 3.5 ADB ile bağlan
adb connect SUNUCU_IP:5555
adb devices
```

Bu adımlar çalışırsa, gerçek cloud phone altyapın hazır demektir.

---

## 4. Platformu sunucuya bağlama

Sunucuda emulator çalıştıktan sonra, bu projeyi şu şekilde bağlarız:

1. **API + worker + DB + Redis** aynı sunucuda Docker Compose ile çalışır
   (repo'daki `docker-compose.yml` zaten hazır — `docker compose up -d`).
2. API'nin `docker.service.ts` katmanı, "Start" job'u geldiğinde sunucuda yeni bir
   `budtmo/docker-android` konteyneri açar, ADB host/port'unu DB'ye yazar.
3. Dashboard'daki **Profiles → Start** butonu bu job'u tetikler.
4. Her telefonun noVNC ekranı dashboard'a `iframe`/canlı görüntü olarak gömülür.

> Şu an dashboard butonları cihaz kaydını (DB) yönetiyor. Sunucu hazır olunca
> `docker.service.ts`'i gerçek konteyner açacak şekilde aktif edeceğim (kod iskeleti mevcut).

---

## 5. Diğer maliyet kalemleri (opsiyonel, sonra)

| Kalem | Ne için | Yaklaşık |
|-------|---------|----------|
| Residential/mobil proxy | Her telefona farklı IP | GB başına ~$3–8 |
| Object storage (S3/R2) | APK ve medya saklama | ~$5/ay |
| Domain + SSL | siteadi.com (Cloudflare ücretsiz SSL) | ~$10/yıl |
| Claude API key | Fleet AI / içerik üretimi | kullanıma göre |

---

## 6. Sıradaki adım

1. Yukarıdaki listeden bir Hetzner sunucu seç (öneri: **AX52**).
2. Ubuntu 24.04 ile kur, SSH erişimini bana ver.
3. Ben adım 3 ve 4'ü çalıştırıp ilk gerçek telefonu açarım, dashboard'a bağlarım.

Sorun: Hangi modeli seçeceğine karar veremezsen, kaç telefon çalıştırmak
istediğini söyle (örn. "10 telefon") — sana net model + maliyet veririm.
