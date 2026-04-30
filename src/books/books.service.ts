import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BooksService {
  constructor(private prisma: PrismaService) {}

  async create(input: {
    title: string;
    author: string;
    isbn?: string;
    description?: string;
    coverUrl?: string;
    initialCopies: number;
  }) {
    const codePrefix = (input.isbn ?? input.title.slice(0, 4).toUpperCase().replace(/\s+/g, '')) || 'BOOK';
    const ts = Date.now();
    return this.prisma.book.create({
      data: {
        title: input.title,
        author: input.author,
        isbn: input.isbn ?? null,
        description: input.description ?? null,
        coverUrl: input.coverUrl ?? null,
        copies: {
          create: Array.from({ length: input.initialCopies }).map((_, i) => ({
            code: `${codePrefix}-${ts}-${i}`,
          })),
        },
      },
      include: { copies: true },
    });
  }

  async update(
    id: string,
    input: {
      title?: string;
      author?: string;
      isbn?: string;
      description?: string;
      coverUrl?: string;
    },
  ) {
    return this.prisma.book.update({
      where: { id },
      data: input,
      include: { copies: true },
    });
  }

  async remove(id: string) {
    const active = await this.prisma.reservation.count({
      where: { status: 'ACTIVE', bookCopy: { bookId: id } },
    });
    if (active > 0) {
      throw new BadRequestException({
        message: 'Book has active reservations',
        code: 'BOOK_HAS_ACTIVE_RESERVATIONS',
      });
    }
    await this.prisma.book.delete({ where: { id } });
    return true;
  }

  async findAll(opts: { available?: boolean }) {
    const books = await this.prisma.book.findMany({
      include: { copies: true },
      orderBy: { title: 'asc' },
    });
    if (opts.available) {
      return books.filter((b) =>
        b.copies.some((c) => c.status === 'AVAILABLE'),
      );
    }
    return books;
  }

  async findOne(id: string) {
    const book = await this.prisma.book.findUnique({
      where: { id },
      include: { copies: true },
    });
    if (!book) {
      throw new NotFoundException({
        message: 'Book not found',
        code: 'NOT_FOUND',
      });
    }
    return book;
  }

  async addCopy(bookId: string) {
    const code = `${bookId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 4)}`;
    return this.prisma.bookCopy.create({ data: { bookId, code } });
  }

  async removeCopy(copyId: string) {
    const copy = await this.prisma.bookCopy.findUnique({
      where: { id: copyId },
    });
    if (!copy) {
      throw new NotFoundException({
        message: 'Copy not found',
        code: 'NOT_FOUND',
      });
    }
    if (copy.status !== 'AVAILABLE') {
      throw new BadRequestException({
        message: 'Copy not available',
        code: 'COPY_NOT_AVAILABLE',
      });
    }
    await this.prisma.bookCopy.delete({ where: { id: copyId } });
    return true;
  }
}
