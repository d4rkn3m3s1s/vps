---
name: pc-cokme-ntfs-ajan-yasak-2026-07-27
description: "★★KRİTİK ORTAM KURALI: Kullanıcının PC'si (Windows 11 build 26200) arka-plan/paralel AJAN başlatılınca BSOD veriyor. KÖK: Windows çekirdeğinde NTFS dizin-tarama bug'ı — KERNEL_SECURITY_CHECK_FAILURE (0x139), PROCESS_NAME claude.exe, Ntfs!NtfsQueryDirectory çağrısında çöküyor (GitHub'da aynı-sınıf açık issue var). Ajanlar proje klasörünü (Glob/dizin-enum) yoğun tarayınca çekirdek hatası tetikleniyor — çökme Claude'da DEĞİL Windows çekirdeğinde. ★KURAL: bu projede ASLA Agent tool ile arka-plan/paralel ajan başlatma, YOĞUN Glob/dizin-taraması yapma. YERİNE: (1)dosya-adı biliyorsan direkt Read, (2)geniş-tarama yerine tek hedefli Grep(ripgrep, dizin-enum'dan hafif), (3)EN İYİSİ ağır analizi UZAK SUNUCUDA yap — ssh phoenixnap_y ubuntu@125.253.73.45, kod /opt/fleet'te, grep sunucunun Linux-FS'inde çalışır Windows-NTFS'e hiç dokunmaz. Hafif çözüm: proje klasörünü Windows Defender istisnasına ekle + Claude Code/VSCode güncelle + Windows Update(26200 fix)."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-27T00:30:50.545Z
---

# ★★ PC ÇÖKME — arka-plan ajan YASAK (NTFS çekirdek bug'ı) — 2026-07-27

Kullanıcı: "sen ajanları başlatınca pc çöküyor bu çok önemli". Dump analizi +
GitHub issue eşleşmesi ile kök bulundu.

## KÖK NEDEN (Claude'un hatası DEĞİL — Windows çekirdek bug'ı)
- Windows 11 build **26200** serisinde NTFS dizin-tarama çekirdek hatası.
- BSOD: `KERNEL_SECURITY_CHECK_FAILURE (0x139)`, `PROCESS_NAME: claude.exe`,
  `Ntfs!NtfsQueryDirectory` çağrısında çöküyor. GitHub Claude Code'da aynı-sınıf
  açık issue var (WOF filtre-sürücüsü ilişkili).
- Claude Code ajanları proje klasörünü çok yoğun tarıyor (Glob/dizin-enum) →
  Windows'un dosya-sistemi filtre-sürücüsündeki çekirdek bug'ını tetikliyor →
  asıl çökme Windows çekirdeğinde. Claude sadece tetikleyen iş-yükünü üretiyor.

## ★ KURAL (bu ortamda kalıcı)
1. **ASLA Agent tool ile arka-plan/paralel ajan başlatma** (async agent = yoğun
   dizin-tarama = BSOD). Kullanıcı bunu iki kez yaşadı (fırsat-tarama 4-ajan → çöktü).
2. **Yoğun Glob/dizin-enumerasyonu yapma.** Yerine:
   - Dosya-adı biliyorsan → direkt `Read`.
   - Geniş-tarama yerine → tek hedefli `Grep` (ripgrep, dizin-enum'dan çok hafif).
3. **★ EN İYİ YÖNTEM: ağır analizi UZAK SUNUCUDA yap.** Kod zaten sunucuda
   (`/opt/fleet`, agent `/opt/agent.mjs`). `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`
   ile `grep`/`node -e` sunucunun **Linux** dosya-sisteminde çalışır → Windows NTFS'e
   HİÇ dokunmaz → çökme tetiklenmez. Fırsat-taramasının tamamı bu yöntemle yapıldı, sorunsuz.

## ★★ ÇÖZÜM UYGULANDI (2026-07-27 — ÇALIŞTI!)
Kullanıcı yönetici-PowerShell'de şunu ekledi:
```
Add-MpPreference -ExclusionPath "c:\Yeni klasör\vps"
Add-MpPreference -ExclusionProcess "claude.exe"
```
SONUÇ: İstisna sonrası ağır ajan (general-purpose, Glob+19 tool-use, tam proje taraması,
177sn) kullanıcının PC'sinde SORUNSUZ çalıştı — ÇÖKME YOK. Yani Defender-istisnası
kök-tetikleyiciyi (Defender+ajan-taraması üst üste binmesi) çözdü. ★ARTIK AJAN KULLANILABİLİR
(istisna aktifken). Yine de temkinli ol: önce hafif-test-ajanı, sonra ağır. İstisna
kaldırılırsa/başka-PC'de risk geri gelir.

## HAFİF ÇÖZÜMLER (ek, kullanıcı tarafı)
- Claude Code + VSCode güncelle. Windows Update (26200 için fix gelmiş olabilir) +
  BIOS/chipset.

## DERS
Bu projede iş yaparken varsayılan "çoklu-ajan-paralel-tara" yaklaşımı ÇÖKERTİR.
Tek-işe-odaklan + sunucuda-analiz + hedefli-Read/Grep = güvenli mod.
