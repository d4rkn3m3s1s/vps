---
name: hosts-heartbeat-security-fix
description: "2026-06-29: /hosts/:id/heartbeat cross-tenant açığı + host-delete IDOR kapatıldı. Heartbeat artık per-host agent key (x-agent-key) ister; delete workspace-scoped."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Audit'teki [[feature-honesty-audit]] güvenlik maddesi: `/hosts/:id/heartbeat` SADECE requireApiKey ile
korunuyordu (JWT/workspace YOK, agent-key YOK) → paylaşılan API key'i olan herkes HERHANGİ bir host'u
id ile heartbeat edebiliyordu (cross-tenant). Ayrıca `deleteHostHandler` workspace-scope YAPMADAN
remove(id) çağırıyordu → A workspace admin'i B'nin host'unu id ile silebilir (IDOR).

DÜZELTME (apps/api/src/modules/hosts):
- routes: heartbeat artık `requireApiKey + requireHostAgent` (x-agent-key, sha256→Host.agentKeyHash).
  Agent endpoint'leriyle AYNI kimlik doğrulama (zaten vardı, hosts'a uygulanmamıştı).
- controller.heartbeatHostHandler: `req.hostAgent.id !== :id` ise 403 HOST_FORBIDDEN → host yalnız
  KENDİNİ heartbeat eder.
- controller.deleteHostHandler: `remove(id, getWorkspaceId(req))`.
- service.remove: findFirst({id, workspaceId}) — başka tenant'ın host'u "not found".
- service.heartbeat: assertExists kaldırıldı (zaten agent-key ile doğrulanmış; Prisma update yoksa fırlatır).

DOĞRULANDI (canlı): agent-key YOK → 401 (eskiden 200), geçerli key + YANLIŞ host id → 403, geçerli key +
KENDİ host id → 200. tsc temiz.

NOT: Bu host agent gerçek bir KVM/Vast.ai host'unun /hosts/:id/heartbeat'i; cihaz agent'ı (agent.mjs)
ZATEN /agent/heartbeat kullanıyor (o yol güvenliydi). Bu fix orphan /hosts heartbeat yolunu da güvene aldı.
