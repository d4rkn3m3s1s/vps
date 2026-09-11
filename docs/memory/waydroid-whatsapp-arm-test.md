---
name: waydroid-whatsapp-arm-test
description: "2026-07-02: Scaleway ARM'da Waydroid WhatsApp testi. redroid text/tıklama ölü; Waydroid'de tıklama+ADBKeyboard text ÇÖZÜLDÜ, numara girildi WhatsApp 'Connecting' dedi. KALAN: Scaleway /32 NAT engeli (internet çıkışı yok) + Magisk/integrity. Tam reçete vault'ta."
metadata:
  type: project
---

**Scaleway BASIC2-A4C-16G (Ampere ARM, €0.087/saat, IP 51.158.107.121) üzerinde WhatsApp farm için Android motoru testi.**

## KANIT: Waydroid >> redroid (WhatsApp için)
- **redroid:** `/dev/input` boş → tıklama VE text ÖLÜ. WhatsApp companion-mode'a takılıyor. WhatsApp farm için UYGUNSUZ.
- **Waydroid (Android 13, GApps'lı):** tıklama ÇALIŞIYOR (Register new account, ülke dropdown, liste). **ADBKeyboard broadcast ile TEXT girişi ÇALIŞIYOR** (redroid'de çözülemeyen). Numara girildi (+90 5457438530), Next yeşil, WhatsApp "Connecting" (numara kabul edildi).

## ÇÖZÜLEN: text input (araştırma da doğruladı en zor sorun)
ADBKeyboard.apk kur → ime enable/set com.android.adbkeyboard/.AdbIME → tıkla → `am broadcast -a ADB_INPUT_TEXT --es msg 'x'`. Waydroid'de çalışır, redroid EditText'inde çalışmaz.

## ÇÖZÜLEMEYEN: Scaleway /32 NAT (MİMARİ DEĞİL, sağlayıcı sorunu)
Host IP /32 (gateway farklı subnet). Waydroid iç ağ host'a ulaşıyor ama internete çıkamıyor. Kernel MASQUERADE (POSTROUTING sayacı 0, enp0s1'e paket gitmiyor), slirp4netns (Android namespace'e tap ekleyemez "child failed"), manuel route (netd eziyor) — HEPSİ başarısız. Normal-NAT sağlayıcıda (OVH/Oracle/bare-metal) olmaz.

## KALAN: Magisk stack (araştırma doğruladı, eklenmedi)
redroid A11 + LiteGApps + Magisk Delta + Zygisk + Shamiko + PIF + TrickyStore = topluluk "çalıştı" raporu. WhatsApp: Magisk+PIF+LSPosed+BootloaderSpoofer. waydroid-script ile Waydroid'e Magisk eklenebilir.

## Waydroid headless kurulum engelleri (hepsi çözüldü, reçete vault'ta)
binder(linux-modules-extra) + iptables/bridge/xt_CHECKSUM modülleri + iptables-legacy + weston headless + PULSEAUDIO native socket (LXC mount için ŞART). Tam reçete: C:\obsidian\crosscut\waydroid-whatsapp-arm-test.md

## ARAŞTIRMA (101 ajan, 18 kaynak, adversarial-doğrulandı)
ARM cloud phone (VMOS/GeeLark) tespit-muaf (Group-IB 2026, x86 emülatör %95 yakalanıyor). Self-hosted için Waydroid+ADBKeyboard+Magisk doğru yol. [[cloud-provider-adapter]] adapter hazır = garantili yol.

## SONRAKİ OTURUM: OVH/Oracle ARM'da bu reçeteyle kur (ağ sorunu olmaz), Magisk ekle, WhatsApp kaydını Connecting→SMS→OTP bitir.
[[session-state-live-issues]] [[whatsapp-avd-registration]] [[cloud-provider-adapter]]
