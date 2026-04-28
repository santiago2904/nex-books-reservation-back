/**
 * Concurrency proof test for R2 (one active reservation per BookCopy).
 *
 * Spawns N concurrent reservation attempts targeting the same single-copy book.
 * Expectation: exactly 1 succeeds; the rest fail. The DB partial unique index
 *   `reservation_active_per_copy` guarantees this even under perfect interleaving.
 *
 * Runs against a live Postgres on $DATABASE_URL. Reseed before this test.
 */
import { PrismaClient } from '@prisma/client';
import { ReservationsService } from '../src/reservations/reservations.service';

const prisma = new PrismaClient();
const svc = new ReservationsService(prisma as never);

async function main() {
  // 1. Setup: create 1 book with 1 copy, plus N test users.
  console.log('Setup: creating 1 book with 1 copy and 10 users…');

  // Clean slate just for this test
  await prisma.reservation.deleteMany({ where: { user: { email: { startsWith: 'race-' } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'race-' } } });
  await prisma.book.deleteMany({ where: { title: { startsWith: 'RACE-TEST-' } } });

  const ts = Date.now();
  const book = await prisma.book.create({
    data: {
      title: `RACE-TEST-${ts}`,
      author: 'Concurrency',
      copies: { create: [{ code: `RACE-${ts}-001` }] },
    },
    include: { copies: true },
  });

  const users = await Promise.all(
    Array.from({ length: 10 }).map((_, i) =>
      prisma.user.create({
        data: {
          name: `Race ${i}`,
          email: `race-${ts}-${i}@nex.test`,
          passwordHash: 'x',
        },
      }),
    ),
  );

  // 2. Race: all 10 try to reserve the single copy at once.
  console.log('Racing: 10 concurrent reservation attempts…');
  const dueDate = new Date(Date.now() + 86_400_000);
  const settled = await Promise.allSettled(
    users.map((u) =>
      svc.create({ userId: u.id, bookId: book.id, dueDate }),
    ),
  );

  const fulfilled = settled.filter((r) => r.status === 'fulfilled');
  const rejected = settled.filter((r) => r.status === 'rejected');

  console.log(`  fulfilled: ${fulfilled.length}`);
  console.log(`  rejected:  ${rejected.length}`);

  // 3. Verify: exactly 1 active reservation in DB
  const activeCount = await prisma.reservation.count({
    where: { status: 'ACTIVE', bookCopy: { bookId: book.id } },
  });
  console.log(`  active reservations in DB: ${activeCount}`);

  // 4. Sample a rejected error to confirm it's the expected one
  const sampleErr = (rejected[0] as PromiseRejectedResult | undefined)?.reason;
  if (sampleErr) {
    const code =
      sampleErr.response?.code ?? sampleErr.code ?? sampleErr.message;
    console.log(`  sample rejection code: ${code}`);
  }

  // 5. Cleanup
  await prisma.reservation.deleteMany({ where: { bookCopy: { bookId: book.id } } });
  await prisma.book.deleteMany({ where: { id: book.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `race-${ts}-` } } });

  // 6. Assert
  const ok =
    fulfilled.length === 1 && rejected.length === 9 && activeCount === 1;
  if (!ok) {
    console.error(
      `\n❌ FAIL: expected 1 fulfilled / 9 rejected / 1 active; got ${fulfilled.length}/${rejected.length}/${activeCount}`,
    );
    process.exit(1);
  }
  console.log('\n✅ PASS: exactly 1 of 10 concurrent reservations won the copy.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
