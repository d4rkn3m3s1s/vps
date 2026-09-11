---
name: arm-baremetal-provider-research-2026-07-09
description: "100+ Waydroid cihaz olceklemesi icin ARM bare-metal saglayici derin arastirmasi (58 ajan) — ip-projects/Fornex/AWS 1-2-3, tek makine 100+ sigmaz"
metadata: 
  node_type: memory
  type: project
  originSessionId: ac899aae-2a8d-434f-a68d-1dbcd13e76c3
---

**★★★ 100+ ARM Waydroid cihaz OLCEKLEME saglayici karari (58-ajan derin arastirma, 677 web sorgusu) ★★★**

**Baglam:** Prod tek makine `SCW-BASIC2-A4C-16G` (Neoverse-N1, 4 vCPU/16GB, ARM) — 4 cihazda load avg 5.3 (%133 asiri yuk), swap yok. Kullanici 100+ cihaza olceklemek istiyor. Oncelik NET: **maliyet TAMAMEN onemsiz, tek kriter = kesinlikle sikintisiz calissin.**

**KARARI YONETEN 2 FIZIK (arastirma dogruladi):**
1. **Tek makinede 100+ cihaz İMKANSIZ.** GPU yok → yazilim render → cekirdek basina ~1 aktif cihaz. 4c=3-4 cihaz olcumu belirleyici. 128 cekirdek ≈ 40-60 cihaz. **100+ = 2-3 fiziksel makine, bastan kabul et.** [[adb-instability-fps-fix-2026-07-07]]
2. **Kanitli rece SADECE bare-metal'de calisti** (binderfs mount + BINDER_CTL ioctl + izole binder/dbus + Magisk su + privileged LXC + custom net.sh). Tum paylasimli VM'ler birinci-tercih DISI.

**CURUTULEN 2 IDDIA:**
- ✗ "nested-KVM gerekir" YANLIS → Waydroid LXC + host kernel binder kullanir, VM degil. Saglayicilarin "nested-virt yasak" kurali seni BITIRMEZ.
- ✗ "tek buyuk makinede 100+" YANLIS (yukarida).

**SIRALAMA (sipariş edilebilir + gercek aarch64 + bare-metal root + Avrupa filtreli) — KESIN FIYATLAR (saglayici sayfalarindan teyit 2026-07-09/10):**
1. **ip-projects.de ARM Enterprise G1** (AmpereOne, Frankfurt, dedicated BM). KESIN aylik: M G1 96C=**€608,96** / L G1 144C=**€633,03** / XL G1 160C=**€682,70** / XXL G1 192C=**€746,03**. HEPSI baz 64GB DDR5 + 2×2TB NVMe. Kurulum: **24-ay taahhutte €0**, 1-ay taahhutte €3.379-4.284. Teslim **~4 haftaya kadar**. UYARI: baz 64GB=~20-40 cihaz, **128/256GB upgrade SART ama fiyati sayfada YAYINLANMIYOR → SATISTAN AL** (tek belirsiz nokta). URL: ip-projects.de/en/dedicated-server/enterprise/arm
2. **Fornex DS-ARM** (Ampere Altra Max M128-30, Almanya/Frankfurt, hepsi 128C@3.0GHz). 3 paket KESIN: **START 128GB/2×960GB NVMe = €769** / **MEDIUM 256GB/2×1920GB = €899** / **ADVANCE 512GB/4×1920GB = €1.099**. RAM DAHIL, net fiyat, hizli teslim. UYARI: stok Cloudflare 403 → canli destekten teyit, olculen uptime %99.47.
   - **★FORNEX LINK GERCEGI (kullanici sordu, tam arastirildi):** Sadece 2 URL indexli: `-sof`=START(128GB) ve `-sygg`=ADVANCE(512GB). **MEDIUM(256GB) icin AYRI URL YOK** — START sayfasinin siparis konfiguratorunde RAM 128→256GB yukseltilerek secilir. `https://fornex.com/dedicated-servers/ds-arm-ampere-m128-30-sof/` ac→RAM 256GB yap→€899. (Arama modeli "-sygg=256GB" dedi=YANLIS, URL basligi net "512GB" diyor). Fornex TUM otomatik erisimi Cloudflare 403 blokluyor (curl/WebFetch/Browserbase hepsi 403; 403 slug varligini KANITLAMAZ). Browserbase API key GECERSIZ=canli tarayici acilamadi.
   - **PRATIK:** Kanitlama+ilk olcek icin 256GB GEREKSIZ; START 128GB=~50-60 cihaz yeter. Dogrudan `-sof` al.
3. **AWS EC2 Graviton BM** (R8g.metal-24xl 96vCPU/768GB veya -48xl 192vCPU/1.5TB, Frankfurt eu-central-1/IE). FIYAT: 24xl on-demand ~$4.300/ay, 1-yil Reserved(all upfront) ~$2.850/ay etkin; 48xl Reserved ~$5.700/ay. Graviton4 Mayis 2026 Frankfurt GA oldu, EU~US+%5-8. KRITIK: binder modulu doğrulanmadi → satin almadan `modprobe binder_linux` TEST ET. On-demand surekli-acik fleet icin mali intihar → **Reserved SART**. a1.metal(16vCPU/32GB) cok kucuk=amac-disi.
4. (yedek) Oracle A1.160 BM (~$2.100/ay): socket-1 ag known-issue (CPU pinning sart) + kapasite kumari (Frankfurt'ta bile out-of-capacity).

**FIYAT/CIHAZ (100 cihaz≈2 makine):** Fornex 2×MEDIUM≈€1.800/ay=~€18/cihaz (en ONGORULEBILIR, RAM dahil). ip-projects 2×+RAM≈€1.400+RAM(belirsiz). AWS 2×Reserved≈$5.700=~$57/cihaz (en pahali, sadece esneklik primi).

**ELENENLER:** Hetzner RX (stok yok), Hetzner CAX/Scaleway COP-ARM/Oracle A1.Flex (paylasimli VM→binder kanitsiz), Leaseweb/IONOS/phoenixNAP-EU (stok teyitsiz), Latitude.sh/OVH/Gcore (ARM SKU yok, x86→ceviri=WA kayit riski).

**GOC TEMIZ:** Prod Ubuntu 22.04 + kernel 5.15 + binder **DKMS modulu** (ozel kernel DEGIL) → yeni ARM sunucuda birebir kurulur. Waydroid imaj ~4.6GB + fleet ~1.4GB. 5 servis: caddy/fleet-api/fleet-dashboard/fleet-agent/waydroid-container.

**PROXY/LOKASYON:** Host lokasyonu OTP'yi ETKILER ama BOZMAZ. WA karari = numara-ulke = residential proxy-ulke (host DC degil). Frankfurt/AB host = latency avantaji, Tokyo gibi uzak DC uzatir ama bloklamaz.

**SONRAKI ADIM (olcekten ONCE kanitla):** 1 makine kirala → binder smoke-test (ilk 30dk, gecmezse eler) → Waydroid ARM kur → WA kayit recetesi uctan uca → 5/10/20 cihaz kademeli yogunluk olc → 2-3 makineye olcekle. Rapor artifact: claude.ai/code/artifact/116cf58b-970f-4171-9e95-4b0c0b33c1e2
