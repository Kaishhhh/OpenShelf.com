import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const BCRYPT_COST = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
  }

  const prisma = new PrismaClient();
  const hashedPassword = await hash(password, BCRYPT_COST);

  await prisma.admin.upsert({
    where: { email },
    update: { password: hashedPassword },
    create: { name: 'Admin', email, password: hashedPassword },
  });

  console.log(`[seed-admin] Admin account ready: ${email}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
