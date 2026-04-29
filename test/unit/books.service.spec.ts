import { setupTestApp, teardownTestApp, TestContext } from '../helpers/test-app';
import { cleanupDb } from '../helpers/db-cleanup';
import { expectRejectsWithCode } from '../helpers/expect-code';
import { makeUser, makeBookWithCopies } from '../helpers/factories';
import { BooksService } from '../../src/books/books.service';

describe('BooksService', () => {
  let ctx: TestContext;
  let svc: BooksService;

  beforeAll(async () => {
    ctx = await setupTestApp();
    svc = ctx.app.get(BooksService);
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(() => cleanupDb(ctx.prisma));

  describe('create', () => {
    it('creates a book with N initial copies, all AVAILABLE', async () => {
      const b = await svc.create({
        title: 'X',
        author: 'Y',
        initialCopies: 3,
      });
      expect(b.copies).toHaveLength(3);
      expect(b.copies.every((c) => c.status === 'AVAILABLE')).toBe(true);
    });
  });

  describe('remove', () => {
    it('rejects deletion when there are active reservations', async () => {
      const book = await makeBookWithCopies(ctx.prisma, 1);
      const user = await makeUser(ctx.prisma);
      await ctx.prisma.bookCopy.update({
        where: { id: book.copies[0].id },
        data: { status: 'RESERVED' },
      });
      await ctx.prisma.reservation.create({
        data: {
          userId: user.id,
          bookCopyId: book.copies[0].id,
          dueDate: new Date(Date.now() + 86_400_000),
          status: 'ACTIVE',
        },
      });
      await expectRejectsWithCode(
        svc.remove(book.id),
        'BOOK_HAS_ACTIVE_RESERVATIONS',
      );
    });

    it('deletes a book and cascades to copies when no active reservations', async () => {
      const book = await makeBookWithCopies(ctx.prisma, 2);
      await svc.remove(book.id);
      const after = await ctx.prisma.book.findUnique({
        where: { id: book.id },
      });
      expect(after).toBeNull();
      const copies = await ctx.prisma.bookCopy.count({
        where: { bookId: book.id },
      });
      expect(copies).toBe(0);
    });
  });

  describe('removeCopy', () => {
    it('fails when copy is not AVAILABLE', async () => {
      const book = await makeBookWithCopies(ctx.prisma, 1);
      await ctx.prisma.bookCopy.update({
        where: { id: book.copies[0].id },
        data: { status: 'RESERVED' },
      });
      await expectRejectsWithCode(
        svc.removeCopy(book.copies[0].id),
        'COPY_NOT_AVAILABLE',
      );
    });

    it('succeeds when copy is AVAILABLE', async () => {
      const book = await makeBookWithCopies(ctx.prisma, 2);
      await svc.removeCopy(book.copies[0].id);
      const remaining = await ctx.prisma.bookCopy.count({
        where: { bookId: book.id },
      });
      expect(remaining).toBe(1);
    });
  });

  describe('addCopy', () => {
    it('creates a new AVAILABLE copy with a unique code', async () => {
      const book = await makeBookWithCopies(ctx.prisma, 1);
      const copy = await svc.addCopy(book.id);
      expect(copy.status).toBe('AVAILABLE');
      expect(copy.bookId).toBe(book.id);
    });
  });

  describe('findAll', () => {
    it('available filter excludes books with all copies RESERVED', async () => {
      const open = await makeBookWithCopies(ctx.prisma, 2);
      const closed = await makeBookWithCopies(ctx.prisma, 1);
      await ctx.prisma.bookCopy.updateMany({
        where: { bookId: closed.id },
        data: { status: 'RESERVED' },
      });
      const available = await svc.findAll({ available: true });
      const ids = available.map((b) => b.id);
      expect(ids).toContain(open.id);
      expect(ids).not.toContain(closed.id);
    });
  });
});
