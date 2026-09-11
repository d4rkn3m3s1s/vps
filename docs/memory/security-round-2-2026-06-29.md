---
name: security-round-2-2026-06-29
description: "2026-06-29 2. güvenlik turu: RPA (tüm metodlar), fingerprint, scheduler cross-tenant IDOR'ları kapatıldı + DoS guard (proxy import) + path-traversal (calendar filename). Explore 25 bulgu."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Explore ajanı 2. güvenlik taraması: 7 CRITICAL IDOR + diğerleri. Gerçek olanları kapattım (bazıları zaten
get(id,ws) ile korunuyordu = over-report).

KAPATILDI (tsc temiz, canlı 404 doğrulandı):
1. **RPA SERVICE — TAM workspace-scope YOKTU (en kritik)**: get/update/remove/run hiç workspaceId almıyordu →
   başka tenant'ın flow'unu OKU/ÇALIŞTIR/SİL. DÜZELTME: get(id, workspaceId) findFirst scoped; update/remove/run
   workspaceId alır; run AYRICA hedef cihazları workspace ile filtreler (yabancı cihaza flow çalıştırılamaz);
   controller hepsine getWorkspaceId geçiyor. CANLI: get/run foreign→404.
2. **Fingerprint service**: assertDevice(deviceId, workspaceId) findFirst scoped; ensure/regenerate/updateGps/
   applyToDevice/provisionIntegrity workspaceId alır; get(deviceId, workspaceId) device-relation ile scoped;
   controller get/regenerate/updateGps'e getWorkspaceId geçiyor (cross-tenant fingerprint oku/yaz kapandı).
3. **Scheduler service**: assertExists(id, workspaceId) findFirst; create device-check workspace-scoped;
   update/remove workspaceId alır; controller geçiyor. CANLI: delete foreign→404.
4. **Library deleteAsset**: findFirst+delete → atomik deleteMany({id, workspaceId}) (TOCTOU penceresi yok).
5. **Proxy bulkImport DoS guard**: text>500KB → 400; satırlar slice(0,5000).
6. **Calendar pushed filename path-traversal**: mediaUrl→filename artık [^a-zA-Z0-9._-]→_ sanitize + slice(128).

OVER-REPORT (zaten korunuyordu, dokunulmadı): cloud-providers update/remove (get(id,ws) önce çağrılıyor),
hosts remove (findFirst+delete, 1. turda fixlendi), calendar update/remove (get post.workspaceId!==ws→403),
snapshots update/delete (workspace check var), secret leakage YOK (toPublic her yerde hasX flag döndürüyor).

7. **device.deleteDevice — CRITICAL IDOR (audit haklıydı)**: assertDeviceExists(id) UNSCOPED idi → herkes id ile
   herhangi cihazı silebiliyordu. DÜZELTME: deleteMany({id, workspaceId}) atomik + count===0→404; controller
   getWorkspaceId geçiyor. CANLI: foreign delete→404, gerçek 3 cihaz korundu (regresyon yok).
8. **device assert helpers (group/host attach)**: assertGroupExists/assertHostExists artık workspaceId alıp findFirst
   scoped → cihazı BAŞKA tenant'ın grup/host'una bağlama deliği kapandı (updateDevice/createDevice call-site'ları geçiyor).

KALAN düşük öncelik: grants/permissions lookup workspace-scope (MED — aynı-isimli grup riski), device-agent
mid-execution re-check (LOW). [[optimization-round-2026-06-29]] + [[device-health-charts]] aynı oturum.
Windows-API kuralı: schema değişmedi bu turda → sadece tsx watch reload + agent restart yeterli.
