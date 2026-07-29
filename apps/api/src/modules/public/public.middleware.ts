import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { asyncHandler } from '../../lib/asyncHandler';
import { requirePublicWorkspace } from './public.guards';
import {
  getWhatsappState,
  checkWhatsappAccess,
  type WhatsappAccessMode
} from '../devices/whatsappCategory';

// Public API'de bir ucun HANGİ cihazda anlamlı olduğunu tek noktadan uygular.
//
// Neden: /public/v1 altındaki ~40 WhatsApp ucu, cihazda hesap olup olmadığına
// bakmadan iş kuyruğa atıyordu. Boş bir cihaza `send` çağrılınca 409 yerine bir
// jobId dönüyor, iş cihazda ölüyor ve entegratör dakikalar sonra anlamsız bir
// CHAT_NOT_OPENED görüyordu. Kural artık istek anında, okunabilir bir hatayla
// uygulanır. Karar tablosu devices/whatsappCategory.ts'te (checkWhatsappAccess) —
// /v1/devices/:id'nin capabilities listesi de aynı tablodan türer.

// deviceId gövdede (POST), query'de (GET) veya yolda (:id) olabilir. Sırayla arar;
// hiçbirinde yoksa null döner ve guard ATLANIR — `stats`, `labels`, `messages` gibi
// uçlarda cihaz gerçekten opsiyoneldir (tüm workspace'i özetlerler).
function resolveDeviceId(req: Request): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  if (fromBody) return fromBody;
  const q = req.query.deviceId;
  const fromQuery = typeof q === 'string' ? q.trim() : '';
  if (fromQuery) return fromQuery;
  const p = req.params.deviceId ?? req.params.id;
  const fromParams = typeof p === 'string' ? p.trim() : '';
  return fromParams || null;
}

// Uyarıyı (RESTRICTED / banlı-ama-okunabilir) cevaba iliştirir. 40 handler'ı tek
// tek değiştirmek yerine res.json'ı bir kez sarmalıyoruz: `data` bir nesneyse
// accountWarning alanı eklenir, değilse cevaba dokunulmaz.
function attachWarning(res: Response, warning: string): void {
  const original = res.json.bind(res);
  res.json = ((payload: unknown) => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const p = payload as Record<string, unknown>;
      if (p.data && typeof p.data === 'object' && !Array.isArray(p.data)) {
        (p.data as Record<string, unknown>).accountWarning = warning;
      }
    }
    return original(payload as never);
  }) as Response['json'];
}

export function requireWhatsappAccount(mode: WhatsappAccessMode): RequestHandler {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const workspaceId = requirePublicWorkspace(req);
    const deviceId = resolveDeviceId(req);
    if (!deviceId) return next();

    // ★Kategoriyi okumadan ÖNCE sahiplik doğrulanır: aksi halde yabancı bir
    // deviceId'ye verilen 409/200 farkı, başka tenant'ın cihazının WhatsApp
    // durumunu sızdıran bir yan kanal olurdu.
    const owned = await prisma.device.findFirst({
      where: { id: deviceId, workspaceId },
      select: { id: true }
    });
    if (!owned) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');

    const state = await getWhatsappState(deviceId);
    const decision = checkWhatsappAccess(state, mode);
    if (!decision.allowed) throw new AppError(decision.message, 409, decision.code);
    if (decision.warning) attachWarning(res, decision.warning);
    next();
  });
}
