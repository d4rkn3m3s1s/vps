---
name: security-round-4
description: "2026-06-30 4. güvenlik turu (16-ajan workflow): SSRF (calendar/files mediaUrl), 3 IDOR (snapshot restore/clone, emulator list, job-create cross-tenant device control), calendar workspace bypass kapatıldı; lib/urlGuard.ts eklendi; tsc temiz"
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**16-ajanlı çok-ajan güvenlik denetimi (bul→rakip-doğrula pipeline): 11 bulgu, 7 doğrulandı (≥8), 4 yanlış-pozitif elendi. Hepsi kapatıldı + tsc --noEmit temiz.**

**Kapatılan açıklar:**
1. **SSRF (HIGH)** — calendar `mediaUrl` + files `push url` host agent tarafından server-side `fetch()` ediliyordu (agent.mjs:1331 `download()`, koruma yok). Saldırı: `mediaUrl=http://169.254.169.254/...` → host cloud metadata'ya erişir. ÇÖZÜM: yeni `apps/api/src/lib/urlGuard.ts` (`assertSafePublicUrl`: http/https zorunlu + DNS çöz + private/loopback/link-local/CGNAT/IPv6-ULA IP blokla). calendar.service create/update + files.service push'a bağlandı.
2. **Snapshot restore/clone IDOR (HIGH)** — `restoreSnapshot`(:80)/`cloneFromSnapshot`(:130) `findUnique` ile scope'suz, kardeş update/delete kontrol yapıyordu. ÇÖZÜM: foreign PRIVATE snapshot → 404; PUBLIC/WORKSPACE market image'ları serbest (özellik korundu). restore'da hedef device-ownership de eklendi.
3. **Job-create cross-tenant device control (HIGH)** — asıl "RPA shell injection" sandığı şey: `POST /jobs` createJobHandler `workspaceId` GEÇMİYORDU + device-ownership YOK → başka workspace'in cihazında rastgele shell/RPA. ÇÖZÜM: jobs.controller targetDeviceId'yi caller workspace'ine doğruluyor (foreign→404) + createJobRecord'a workspaceId geçiyor.
4. **Emulator list IDOR (HIGH conf10)** — `list()` scope'suz findMany. ÇÖZÜM: workspaceId filtresi + route'a authenticateJwt + controller getWorkspaceId. NOT: Emulator.workspaceId NE şemada NE DB'de vardı (önce DeviceGroup'un satırıyla karıştırdım). İKİSİ DE eklendi: (a) schema.prisma Emulator modeline `workspaceId String?` + `@@index([workspaceId])`, (b) migration 20260630140000... değil → 20260630120000_emulator_workspace_id (ALTER TABLE ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS). Sonra API durdur→`prisma generate`→başlat→agent restart yapıldı → cast kaldırıldı, tam tip-güvenli, tsc temiz. CANLI DOĞRULANDI: GET /emulators no-auth → 401.

**RESTART DERSİ (yeni):** tsx kök node_modules'da (monorepo hoisted), `apps/api/node_modules`'da DEĞİL. Start-Process ile `"C:\Yeni klasör\vps\node_modules\tsx\dist\cli.mjs"` watch src/index.ts (cwd=apps/api). Yanlış yol → MODULE_NOT_FOUND, process çöker. API health 200 + agent "stream channel connected" ile doğrula.
5. **Calendar workspace bypass (MED)** — update/remove `if (workspaceId && post.workspaceId && ...)` undefined'da short-circuit. ÇÖZÜM: findFirst workspace-scoped + deleteMany.

**ELENEN yanlış-pozitifler:** snapshot capture IDOR, device-shell cmd injection (zaten scope'lu), fingerprint timezone injection (N/A), batch OTP leak (kendi hesabın, leak değil).

**Files modülünde BONUS:** push() ayrıca device-ownership + library-asset workspace scope eksikti → ikisi de eklendi.

**Kalan (kapatılmadı, tasarım):** password-in-job-payload (MED) — agent'a ADB ile login için şifre göndermek ZORUNLU; DB'de plaintext payload "secret-on-disk" kategorisi (denetim kapsamı dışı). İleride: payload şifreleme veya one-time token.

[[security-round-3-jwt-gap]] [[security-round-2-2026-06-29]]. Vault: crosscut/security-posture.md güncellendi.
