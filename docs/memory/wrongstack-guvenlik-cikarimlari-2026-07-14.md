---
name: wrongstack-guvenlik-cikarimlari-2026-07-14
description: "WrongStack (AI coding ajanı) güvenlik mimarisinden projeye uygulanabilir çıkarımlar 2026-07-14 — EN ÖNEMLİ: agent assertPublicUrl string-prefix IP filtresi decimal/hex/IPv4-mapped ile BYPASS edilebilir + DNS-resolve yok"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**WrongStack (github.com/WrongStack/WrongStack, bir AI coding CLI ajanı) güvenlik incelemesi — projeye çıkarımlar (2026-07-14)**

Kullanıcı "wrongstack.com'u da incele" dedi. WrongStack = Claude Code benzeri terminal AI kodlama ajanı (denetim aracı DEĞİL). Güvenlik mimarisi öğretici. İlgili: [[guvenlik-denetim-fix-2026-07-13]].

## ✅ DÜZELTİLDİ+DEPLOY (2026-07-14): agent SSRF numeric-parse+DNS
agent.mjs assertPublicUrl TAMAMEN yeniden yazıldı (zero-dep node:net+node:dns): isBlockedV4(0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.168/16,192.0.0/24,224/4+)+parseV4(decimal/octal/hex/2-3-part fold)+isBlockedAddress(IPv4-mapped v6 ::ffff:+full v6 blok)+assertPublicResolved(dnsLookup all→her IP blok kontrol, DNS-rebinding). download() her hop assertPublicUrl+assertPublicResolved. ★16/16 bypass testi geçti (2130706433/0x7f000001/0177/::ffff:127.0.0.1/169.254.169.254 hepsi bloklandı, 8.8.8.8/1.1.1.1 geçti). İki sunucu deploy+agent restart+active. Yedek /opt/agent.mjs.bak-ssrf.

## 🔴 (ESKİ) GERÇEK AÇIK: agent SSRF string-filtresi bypass
- `deploy/kvm-host/agent/agent.mjs` `assertPublicUrl` (~satır 3760): IP kontrolü **string-prefix** (`host.startsWith('127.')`, `'10.'` vb.) → BYPASS EDİLEBİLİR:
  - Decimal/octal/hex IP: `http://2130706433/`(=127.0.0.1), `0177.0.0.1`, `0x7f000001` — hiçbiri "127." ile başlamaz.
  - IPv4-mapped IPv6: `[::ffff:127.0.0.1]` / `[::ffff:7f00:1]`.
  - 0/8, 100.64/10 CGNAT, 224/4 multicast — agent yakalamıyor (API tarafı isBlockedIp yakalıyor).
- ★İYİ: agent `download()` (~3780) redirect'leri MANUEL takip edip HER hop'ta assertPublicUrl çağırıyor (per-hop re-validation DOĞRU, WrongStack pattern'i, 5 hop cap). Sorun sadece IP-parse zayıflığı + DNS-resolve YOK.
- ZAAF: agent DNS-resolve etmiyor (zero-dep) → `http://internal.attacker.com` → 169.254.169.254'e resolve eden A kaydı hem ilk hem redirect hop'ta GEÇER (gerçek SSRF vektörü). API tarafı urlGuard.ts DNS-resolve ediyor ama sadece ilk URL, redirect değil (API fetch etmiyor, agent ediyor).

## DÜZELTME (uygula, zero-dep korunur)
1. ★agent assertPublicUrl'ü `node:net` isIP() + numeric parse'a çevir (API'deki isBlockedIp mantığını agent'a taşı: decimal/octal/hex normalize + IPv4-mapped IPv6 re-check + 0/8, 100.64/10, 224/4 blokları). node:net built-in=zero-dep bozmaz. Bu MEVCUT en gerçek açığı kapatır.
2. agent download() içinde her hop öncesi `node:dns`(built-in) ile resolve→isBlockedIp→çözülen IP'ye connect (Host header koru). DNS-rebinding azaltır.
3. ★Env-strip host agent'a: spawn env allowlist (PATH/HOME/LANG/ANDROID_*) + TOKEN/SECRET/KEY/PASSWORD/BEARER/AUTH/COOKIE strip → FLEET_API_KEY/proxy-cred child process (su -c/adb shell) env'ine sızmasın.
4. ★Fail-closed RPA: modules/ai (NL→RPA) + device-agent (Claude telefon sürüyor) = subagent'lar. LLM'in ürettiği RPA step'i ALLOWLIST (tap/type/wait/swipe/openApp/keyevent OK; `shell` default DENY, explicit onay) → prompt-injection ile keyfi komut riski kapanır.

## KALİTE ÇIKARIMLARI (Ersin denetimine eklenebilir)
- Secret format `enc:v1:iv:tag:ct` versiyon prefix'i (lib/crypto.ts) → key-rotation kolay.
- Audit event SHA-256 ZİNCİRLEME (audit.service) → tamper-evident log.
- Capability-declaration: job-type/tool "ne yapıyor" (fs.write/net.outbound/device.control) deklare → isim yerine capability yetki.
- Trust-tier: LLM tool-input/web-fetch/webhook = None-trust (adversarial); User/Config = High. mediaUrl/RPA-text/webhook-payload None-trust işle.
