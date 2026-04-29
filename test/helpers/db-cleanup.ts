import { PrismaService } from '../../src/prisma/prisma.service';

export async function cleanupDb(prisma: PrismaService) {
  await prisma.reservation.deleteMany();
  await prisma.bookCopy.deleteMany();
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
}
