import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

let counter = 0;
const uid = () => `${Date.now()}-${counter++}-${Math.random().toString(36).slice(2, 8)}`;

export async function makeUser(
  prisma: PrismaService,
  opts: Partial<{ email: string; role: Role; password: string; name: string }> = {},
) {
  const password = opts.password ?? 'Test1234!';
  return prisma.user.create({
    data: {
      name: opts.name ?? `User ${uid()}`,
      email: opts.email ?? `u-${uid()}@nex.test`,
      passwordHash: await bcrypt.hash(password, 4),
      role: opts.role ?? 'USER',
    },
  });
}

export async function makeBookWithCopies(
  prisma: PrismaService,
  copies = 1,
  opts: Partial<{ title: string; author: string }> = {},
) {
  const id = uid();
  return prisma.book.create({
    data: {
      title: opts.title ?? `Book ${id}`,
      author: opts.author ?? 'Author',
      copies: {
        create: Array.from({ length: copies }).map((_, i) => ({
          code: `${id}-${i}`,
        })),
      },
    },
    include: { copies: true },
  });
}
