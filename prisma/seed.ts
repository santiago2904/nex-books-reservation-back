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
  // [title, author, copies, isbn?, coverUrl?]
  const titles: Array<[string, string, number, string?, string?]> = [
    ['Cien años de soledad', 'Gabriel García Márquez', 3, '9780307474728', 'https://covers.openlibrary.org/b/isbn/9780307474728-L.jpg'],
    ['La sombra del viento', 'Carlos Ruiz Zafón', 2, '9788408163435', 'https://covers.openlibrary.org/b/isbn/9788408163435-L.jpg'],
    ['Rayuela', 'Julio Cortázar', 2, '9788437604572', 'https://covers.openlibrary.org/b/isbn/9788437604572-L.jpg'],
    ['Pedro Páramo', 'Juan Rulfo', 2, '9780802133908', 'https://covers.openlibrary.org/b/isbn/9780802133908-L.jpg'],
    ['El Aleph', 'Jorge Luis Borges', 3, '9780142437889', 'https://covers.openlibrary.org/b/isbn/9780142437889-L.jpg'],
    ['Ficciones', 'Jorge Luis Borges', 2, '9780802130303', 'https://covers.openlibrary.org/b/isbn/9780802130303-L.jpg'],
    ['Como agua para chocolate', 'Laura Esquivel', 1, '9780385420174', 'https://covers.openlibrary.org/b/isbn/9780385420174-L.jpg'],
    ['La casa de los espíritus', 'Isabel Allende', 2, '9781416549567', 'https://covers.openlibrary.org/b/isbn/9781416549567-L.jpg'],
    ['Crónica de una muerte anunciada', 'Gabriel García Márquez', 3, '9780307389732', 'https://covers.openlibrary.org/b/isbn/9780307389732-L.jpg'],
    ['Clean Code', 'Robert C. Martin', 4, '9780132350884', 'https://covers.openlibrary.org/b/isbn/9780132350884-L.jpg'],
    ['The Pragmatic Programmer', 'Andrew Hunt', 4, '9780135957059', 'https://covers.openlibrary.org/b/isbn/9780135957059-L.jpg'],
    ['Domain-Driven Design', 'Eric Evans', 2, '9780321125217', 'https://covers.openlibrary.org/b/isbn/9780321125217-L.jpg'],
    ['Designing Data-Intensive Applications', 'Martin Kleppmann', 3, '9781449373320', 'https://covers.openlibrary.org/b/isbn/9781449373320-L.jpg'],
    ['Sapiens', 'Yuval Noah Harari', 3, '9780062316097', 'https://covers.openlibrary.org/b/isbn/9780062316097-L.jpg'],
    ['Project Hail Mary', 'Andy Weir', 4, '9780593135204', 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg'],
  ];

  for (const [title, author, copies, isbn, coverUrl] of titles) {
    const slug = title
      .slice(0, 8)
      .toUpperCase()
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9-]/g, '');
    await prisma.book.create({
      data: {
        title,
        author,
        isbn: isbn ?? null,
        coverUrl: coverUrl ?? null,
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
