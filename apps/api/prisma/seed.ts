import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(env.adminPassword, 12);

  await prisma.user.upsert({
    where: { email: env.adminEmail },
    update: { passwordHash, role: 'admin' },
    create: {
      email: env.adminEmail,
      passwordHash,
      role: 'admin'
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
