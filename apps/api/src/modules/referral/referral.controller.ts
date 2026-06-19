import type { Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { referralService, REFERRAL_REWARD_RATE } from './referral.service';

// GET /referral — the caller's own code + aggregated stats.
export async function getReferralHandler(req: Request, res: Response): Promise<void> {
  const userId = req.auth?.userId;
  if (!userId) throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  const [code, stats] = await Promise.all([
    referralService.getOrCreateCode(userId),
    referralService.getStats(userId)
  ]);
  res.json({ data: { code, rewardRate: REFERRAL_REWARD_RATE, ...stats } });
}
