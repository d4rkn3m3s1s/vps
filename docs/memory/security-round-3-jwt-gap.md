---
name: security-round-3-jwt-gap
description: "2026-06-30: 3 GET route'unda JWT eksikti → workspace-scope sessizce bypass oluyordu (cross-tenant IDOR). fingerprint/:deviceId, rpa/:id, users/ düzeltildi (authenticateJwt eklendi); tsc temiz"
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Kök neden sınıfı:** `...(workspaceId ? { workspaceId } : {})` scope idiom'u SADECE route JWT garantiliyorsa güvenli. `requireApiKey`-only (JWT'siz) bir GET route'ta `getWorkspaceId(req)` undefined döner → guard sessizce devre dışı kalır → unscoped sorgu → başka tenant'ın verisi döner. requireApiKey global (herhangi tenant'ın key'i geçer), api-key'den workspace fallback YOK.

**Düzeltilen 3 açık (2026-06-30, hepsi tsc --noEmit temiz):**
- `fingerprint.routes.ts:18` `GET /fingerprints/:deviceId` → `authenticateJwt` eklendi (IMEI/serial/MAC/phone/GPS cross-tenant sızıntısı). 5 kardeş route zaten JWT'liydi, bu tek istisnaydı.
- `rpa.routes.ts:18` `GET /rpa/:id` → `authenticateJwt` eklendi (RpaFlow.steps shell komutları + credential'lar sızıyordu). list route zaten optionalJwt'liydi.
- `users.routes.ts:10` `GET /users` → `authenticateJwt + requireAdmin` eklendi (tüm tenant'ların email/rol/apiKey sayısı dizini JWT'siz okunabiliyordu). create/delete zaten requireAdmin'liydi.

**Dokunulmayan (incelendi, güvenli):** system/overview (sadece count aggregate), catalog apps/templates/listings (global katalog, workspaceId yok), fingerprint/countries (statik). emulators findMany unscoped AMA Emulator modeli global (workspace-scoped Device'tan ayrı) + pre-existing → bu turda dokunulmadı, gelecekte doğrulanmalı.

**Aksiyon:** TÜM requireApiKey-only GET route'ları bu sınıf için denetlenmeli. [[security-round-2-2026-06-29]] [[feature-honesty-audit]]
