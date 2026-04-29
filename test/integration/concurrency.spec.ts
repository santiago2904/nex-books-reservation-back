import { setupTestApp, teardownTestApp, TestContext } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { makeBookWithCopies, makeUser } from '../helpers/factories';
import { ReservationsService } from '../../src/reservations/reservations.service';

describe('Reservations concurrency (R2 — partial unique index)', () => {
  let ctx: TestContext;
  let svc: ReservationsService;

  beforeAll(async () => {
    ctx = await setupTestApp();
    svc = ctx.app.get(ReservationsService);
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(() => cleanupDb(ctx.prisma));

  it('only one of N concurrent reservations for the last copy succeeds', async () => {
    const book = await makeBookWithCopies(ctx.prisma, 1);
    const users = await Promise.all(
      Array.from({ length: 10 }).map(() => makeUser(ctx.prisma)),
    );
    const dueDate = new Date(Date.now() + 86_400_000);

    const settled = await Promise.allSettled(
      users.map((u) =>
        svc.create({ userId: u.id, bookId: book.id, dueDate }),
      ),
    );
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    const active = await ctx.prisma.reservation.count({
      where: { status: 'ACTIVE', bookCopy: { bookId: book.id } },
    });
    expect(active).toBe(1);
  });

  it('with M copies and N>M users, exactly M reservations succeed', async () => {
    const book = await makeBookWithCopies(ctx.prisma, 3);
    const users = await Promise.all(
      Array.from({ length: 8 }).map(() => makeUser(ctx.prisma)),
    );
    const dueDate = new Date(Date.now() + 86_400_000);

    const settled = await Promise.allSettled(
      users.map((u) =>
        svc.create({ userId: u.id, bookId: book.id, dueDate }),
      ),
    );
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);

    const active = await ctx.prisma.reservation.count({
      where: { status: 'ACTIVE', bookCopy: { bookId: book.id } },
    });
    expect(active).toBe(3);

    const reservedCopies = await ctx.prisma.bookCopy.count({
      where: { bookId: book.id, status: 'RESERVED' },
    });
    expect(reservedCopies).toBe(3);
  });
});
