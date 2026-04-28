import { CopyStatus, PrismaClient, ResStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning database…');
  await prisma.reservation.deleteMany();
  await prisma.bookCopy.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding users…');
  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@nex.test',
      passwordHash: await bcrypt.hash('Admin123!', 12),
      role: Role.ADMIN,
    },
  });
  const ana = await prisma.user.create({
    data: {
      name: 'Ana',
      email: 'ana@nex.test',
      passwordHash: await bcrypt.hash('User1234!', 12),
      role: Role.USER,
    },
  });
  await prisma.user.create({
    data: {
      name: 'Bruno',
      email: 'bruno@nex.test',
      passwordHash: await bcrypt.hash('User1234!', 12),
      role: Role.USER,
    },
  });

  console.log('Seeding books…');
  const titles: Array<[string, string, number]> = [
    ['Cien años de soledad', 'Gabriel García Márquez', 3],
    ['La sombra del viento', 'Carlos Ruiz Zafón', 2],
    ['Rayuela', 'Julio Cortázar', 2],
    ['Pedro Páramo', 'Juan Rulfo', 2],
    ['El Aleph', 'Jorge Luis Borges', 3],
    ['Ficciones', 'Jorge Luis Borges', 2],
    ['Como agua para chocolate', 'Laura Esquivel', 1],
    ['La casa de los espíritus', 'Isabel Allende', 2],
    ['Crónica de una muerte anunciada', 'Gabriel García Márquez', 3],
    ['Clean Code', 'Robert C. Martin', 4],
    ['The Pragmatic Programmer', 'Andrew Hunt', 4],
    ['Domain-Driven Design', 'Eric Evans', 2],
    ['Designing Data-Intensive Applications', 'Martin Kleppmann', 3],
    ['Sapiens', 'Yuval Noah Harari', 3],
    ['Project Hail Mary', 'Andy Weir', 4],
  ];

  for (const [title, author, copies] of titles) {
    const slug = title
      .slice(0, 8)
      .toUpperCase()
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9-]/g, '');
    await prisma.book.create({
      data: {
        title,
        author,
        copies: {
          create: Array.from({ length: copies }).map((_, i) => ({
            code: `${slug}-${i + 1}`,
          })),
        },
      },
    });
  }

  console.log('Seeding active reservations…');
  const cien = await prisma.book.findFirst({
    where: { title: 'Cien años de soledad' },
    include: { copies: true },
  });
  if (cien) {
    const copy = cien.copies[0];
    if (!copy) throw new Error('expected at least one copy');
    await prisma.bookCopy.update({
      where: { id: copy.id },
      data: { status: CopyStatus.RESERVED },
    });
    await prisma.reservation.create({
      data: {
        userId: ana.id,
        bookCopyId: copy.id,
        status: ResStatus.ACTIVE,
        dueDate: new Date(Date.now() + 7 * 86_400_000),
      },
    });
  }

  console.log('Seed complete:');
  console.log('  admin@nex.test / Admin123!  (ADMIN)');
  console.log('  ana@nex.test   / User1234!');
  console.log('  bruno@nex.test / User1234!');
  void admin;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
