import { setupTestApp, teardownTestApp, TestContext } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { expectRejectsWithCode } from '../helpers/expect-code';
import { makeBookWithCopies, makeUser } from '../helpers/factories';
import { ReservationsService } from '../../src/reservations/reservations.service';

describe('ReservationsService', () => {
  let ctx: TestContext;
  let svc: ReservationsService;

  const tomorrow = () => new Date(Date.now() + 86_400_000);
  const inWeek = () => new Date(Date.now() + 7 * 86_400_000);

  beforeAll(async () => {
    ctx = await setupTestApp();
    svc = ctx.app.get(ReservationsService);
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(() => cleanupDb(ctx.prisma));

  describe('R1: requires user, book, dates with dueDate > now', () => {
    it('creates a reservation with valid input', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 2);
      const r = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      expect(r.status).toBe('ACTIVE');
      expect(r.userId).toBe(user.id);
      const copy = await ctx.prisma.bookCopy.findUnique({
        where: { id: r.bookCopyId },
      });
      expect(copy?.status).toBe('RESERVED');
    });

    it('rejects dueDate <= now', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await expectRejectsWithCode(
        svc.create({
          userId: user.id,
          bookId: book.id,
          dueDate: new Date(Date.now() - 1000),
        }),
        'INVALID_DUE_DATE',
      );
    });
  });

  describe('R2: at most one active reservation per copy', () => {
    it('rejects when no copies are available', async () => {
      const u1 = await makeUser(ctx.prisma);
      const u2 = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await svc.create({
        userId: u1.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      await expectRejectsWithCode(
        svc.create({ userId: u2.id, bookId: book.id, dueDate: tomorrow() }),
        'NO_COPIES_AVAILABLE',
      );
    });

    it('reserves a different copy when one is taken (multi-copy)', async () => {
      const u1 = await makeUser(ctx.prisma);
      const u2 = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 2);
      const r1 = await svc.create({
        userId: u1.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      const r2 = await svc.create({
        userId: u2.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      expect(r1.bookCopyId).not.toBe(r2.bookCopyId);
    });
  });

  describe('R3: a book may be returned before its dueDate', () => {
    it('returnBook succeeds well before dueDate', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      const r = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: inWeek(),
      });
      const returned = await svc.returnBook(r.id, {
        userId: user.id,
        role: 'USER',
      });
      expect(returned.status).toBe('RETURNED');
      expect(returned.returnedAt).not.toBeNull();
      const copy = await ctx.prisma.bookCopy.findUnique({
        where: { id: r.bookCopyId },
      });
      expect(copy?.status).toBe('AVAILABLE');
    });

    it('rejects returning an already-returned reservation', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      const r = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      await svc.returnBook(r.id, { userId: user.id, role: 'USER' });
      await expectRejectsWithCode(
        svc.returnBook(r.id, { userId: user.id, role: 'USER' }),
        'RESERVATION_NOT_ACTIVE',
      );
    });

    describe('ownership on return', () => {
      it('rejects return by a non-owner USER', async () => {
        const owner = await makeUser(ctx.prisma);
        const stranger = await makeUser(ctx.prisma);
        const book = await makeBookWithCopies(ctx.prisma, 1);
        const r = await svc.create({
          userId: owner.id,
          bookId: book.id,
          dueDate: tomorrow(),
        });
        await expectRejectsWithCode(
          svc.returnBook(r.id, { userId: stranger.id, role: 'USER' }),
          'FORBIDDEN',
        );
      });

      it('allows return by ADMIN for any user reservation', async () => {
        const owner = await makeUser(ctx.prisma);
        const admin = await makeUser(ctx.prisma, { role: 'ADMIN' });
        const book = await makeBookWithCopies(ctx.prisma, 1);
        const r = await svc.create({
          userId: owner.id,
          bookId: book.id,
          dueDate: tomorrow(),
        });
        const returned = await svc.returnBook(r.id, {
          userId: admin.id,
          role: 'ADMIN',
        });
        expect(returned.status).toBe('RETURNED');
      });
    });
  });

  describe('R4: max 3 active reservations per user', () => {
    it('rejects the 4th simultaneous active reservation', async () => {
      const user = await makeUser(ctx.prisma);
      for (let i = 0; i < 3; i++) {
        const b = await makeBookWithCopies(ctx.prisma, 1);
        await svc.create({
          userId: user.id,
          bookId: b.id,
          dueDate: tomorrow(),
        });
      }
      const fourth = await makeBookWithCopies(ctx.prisma, 1);
      await expectRejectsWithCode(
        svc.create({
          userId: user.id,
          bookId: fourth.id,
          dueDate: tomorrow(),
        }),
        'MAX_ACTIVE_RESERVATIONS',
      );
    });

    it('allows a new reservation after returning one (cap is on active only)', async () => {
      const user = await makeUser(ctx.prisma);
      const books = await Promise.all(
        [0, 1, 2].map(() => makeBookWithCopies(ctx.prisma, 1)),
      );
      const reservations = [];
      for (const b of books) {
        reservations.push(
          await svc.create({
            userId: user.id,
            bookId: b.id,
            dueDate: tomorrow(),
          }),
        );
      }
      // Return the first one to free a slot
      await svc.returnBook(reservations[0].id, {
        userId: user.id,
        role: 'USER',
      });
      const fourth = await makeBookWithCopies(ctx.prisma, 1);
      const r4 = await svc.create({
        userId: user.id,
        bookId: fourth.id,
        dueDate: tomorrow(),
      });
      expect(r4.status).toBe('ACTIVE');
    });
  });

  describe('R5: queries support date filters', () => {
    it('myReservations filters by reservedAt range', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      const inWindow = await svc.myReservations(user.id, {
        from: new Date(Date.now() - 3600_000),
        to: new Date(Date.now() + 3600_000),
      });
      expect(inWindow).toHaveLength(1);
      const outOfWindow = await svc.myReservations(user.id, {
        from: new Date(Date.now() - 7 * 86_400_000),
        to: new Date(Date.now() - 86_400_000),
      });
      expect(outOfWindow).toHaveLength(0);
    });

    it('reservationsByBook filters by reservedAt range', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      const inWindow = await svc.reservationsByBook(book.id, {
        from: new Date(Date.now() - 3600_000),
        to: new Date(Date.now() + 3600_000),
      });
      expect(inWindow).toHaveLength(1);
    });

    it('reservationsByUser filters by reservedAt range', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
      });
      const all = await svc.reservationsByUser(user.id, {});
      expect(all).toHaveLength(1);
    });
  });

  describe('idempotency', () => {
    it('same idempotencyKey returns the same reservation, not a new one', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 2);
      const key = 'idem-test-1';
      const r1 = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
        idempotencyKey: key,
      });
      const r2 = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
        idempotencyKey: key,
      });
      expect(r2.id).toBe(r1.id);
      const count = await ctx.prisma.reservation.count({
        where: { userId: user.id },
      });
      expect(count).toBe(1);
    });

    it('different idempotency keys produce distinct reservations', async () => {
      const user = await makeUser(ctx.prisma);
      const book = await makeBookWithCopies(ctx.prisma, 2);
      const r1 = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
        idempotencyKey: 'key-A',
      });
      const r2 = await svc.create({
        userId: user.id,
        bookId: book.id,
        dueDate: tomorrow(),
        idempotencyKey: 'key-B',
      });
      expect(r2.id).not.toBe(r1.id);
    });
  });
});
