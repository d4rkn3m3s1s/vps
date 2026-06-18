import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

// 20% of an invitee's first payment is credited back to the referrer.
export const REFERRAL_REWARD_RATE = 0.2;

// Unambiguous alphabet (no 0/O/1/I) for human-shareable codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(len = 6): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const referralService = {
  // Returns the user's stable referral code, creating one on first call.
  async getOrCreateCode(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    if (user.referralCode) return user.referralCode;

    // Retry on the (extremely unlikely) unique collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateCode();
      const taken = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
      if (taken) continue;
      const updated = await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return updated.referralCode!;
    }
    throw new AppError('Could not allocate a referral code', 500, 'REFERRAL_CODE_ALLOC_FAILED');
  },

  // Aggregated stats for the referrer's dashboard.
  async getStats(userId: string) {
    const rows = await prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' }
    });
    const invited = rows.length;
    const signedUp = rows.filter((r) => r.status === 'SIGNED_UP' || r.status === 'CONVERTED').length;
    const converted = rows.filter((r) => r.status === 'CONVERTED');
    const creditsEarnedCents = converted.reduce((sum, r) => sum + r.rewardCents, 0);
    const pendingCents = rows
      .filter((r) => r.status === 'SIGNED_UP')
      .reduce((sum, r) => sum + r.rewardCents, 0);

    return {
      invited,
      signedUp,
      converted: converted.length,
      creditsEarnedCents,
      pendingCents,
      recent: rows.slice(0, 20).map((r) => ({
        id: r.id,
        email: maskEmail(r.referredEmail),
        status: r.status,
        rewardCents: r.rewardCents,
        createdAt: r.createdAt
      }))
    };
  },

  // Records a new referral when someone signs up via a code. Idempotent on
  // (referrer, email). Safe to call from the signup flow.
  async recordSignup(code: string, referredEmail: string): Promise<void> {
    const referrer = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!referrer) return; // unknown code — silently ignore
    const existing = await prisma.referral.findFirst({
      where: { referrerId: referrer.id, referredEmail }
    });
    if (existing) return;
    await prisma.referral.create({
      data: { referrerId: referrer.id, referredEmail, status: 'SIGNED_UP' }
    });
  }
};

// Show only the first character + domain so the referrer sees activity without
// us leaking a full invitee email address.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local[0]}***@${domain}`;
}
