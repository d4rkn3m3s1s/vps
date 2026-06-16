import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { apiKeys: true, auditLogs: true } }
    }
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    apiKeyCount: u._count.apiKeys,
    activityCount: u._count.auditLogs
  }));
}

export async function createUser(input: { email: string; password: string; role?: string | undefined }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError('A user with that email already exists', 409, 'USER_EXISTS');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, role: input.role ?? 'member' }
  });
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

export async function deleteUser(id: string, currentUserId?: string) {
  if (id === currentUserId) throw new AppError('You cannot delete your own account', 400, 'CANNOT_DELETE_SELF');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  await prisma.user.delete({ where: { id } });
  return { id };
}
