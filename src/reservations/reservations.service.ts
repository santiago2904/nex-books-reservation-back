import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ResStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ACTIVE = 3;
const MAX_ATTEMPTS = 3;

interface ReservationFilters {
  from?: Date;
  to?: Date;
  status?: ResStatus;
}

@Injectable()
export class ReservationsService {
  constructor(private prisma: PrismaService) {}

  async create(input: {
    userId: string;
    bookId: string;
    dueDate: Date;
    idempotencyKey?: string;
  }) {
    if (input.dueDate.getTime() <= Date.now()) {
      throw new BadRequestException({
        message: 'dueDate must be in the future',
        code: 'INVALID_DUE_DATE',
      });
    }

    if (input.idempotencyKey) {
      const existing = await this.prisma.reservation.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;
    }

    const active = await this.prisma.reservation.count({
      where: { userId: input.userId, status: 'ACTIVE' },
    });
    if (active >= MAX_ACTIVE) {
      throw new BadRequestException({
        message: 'Max active reservations reached',
        code: 'MAX_ACTIVE_RESERVATIONS',
      });
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const copy = await this.prisma.bookCopy.findFirst({
        where: { bookId: input.bookId, status: 'AVAILABLE' },
      });
      if (!copy) {
        throw new BadRequestException({
          message: 'No copies available',
          code: 'NO_COPIES_AVAILABLE',
        });
      }
      try {
        const [reservation] = await this.prisma.$transaction([
          this.prisma.reservation.create({
            data: {
              userId: input.userId,
              bookCopyId: copy.id,
              dueDate: input.dueDate,
              idempotencyKey: input.idempotencyKey ?? null,
              status: 'ACTIVE',
            },
            include: { bookCopy: { include: { book: true } }, user: true },
          }),
          this.prisma.bookCopy.update({
            where: { id: copy.id },
            data: { status: 'RESERVED' },
          }),
        ]);
        return reservation;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          // Another transaction grabbed this copy; retry with the next available copy.
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException({
      message: 'Race retry exhausted',
      code: 'RACE_RETRY_EXHAUSTED',
    });
  }

  async returnBook(
    reservationId: string,
    requester: { userId: string; role: string },
  ) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!r) {
      throw new NotFoundException({
        message: 'Reservation not found',
        code: 'NOT_FOUND',
      });
    }
    if (r.userId !== requester.userId && requester.role !== 'ADMIN') {
      throw new ForbiddenException({
        message: 'Forbidden',
        code: 'FORBIDDEN',
      });
    }
    if (r.status !== 'ACTIVE') {
      throw new BadRequestException({
        message: 'Reservation not active',
        code: 'RESERVATION_NOT_ACTIVE',
      });
    }
    // Order matters: free the copy first so the included bookCopy reflects AVAILABLE.
    const [, updated] = await this.prisma.$transaction([
      this.prisma.bookCopy.update({
        where: { id: r.bookCopyId },
        data: { status: 'AVAILABLE' },
      }),
      this.prisma.reservation.update({
        where: { id: reservationId },
        data: { status: 'RETURNED', returnedAt: new Date() },
        include: { bookCopy: { include: { book: true } }, user: true },
      }),
    ]);
    return updated;
  }

  myReservations(userId: string, filters: ReservationFilters) {
    return this.prisma.reservation.findMany({
      where: {
        userId,
        status: filters.status,
        reservedAt:
          filters.from || filters.to
            ? { gte: filters.from, lte: filters.to }
            : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }

  reservationsByBook(bookId: string, filters: ReservationFilters) {
    return this.prisma.reservation.findMany({
      where: {
        bookCopy: { bookId },
        reservedAt:
          filters.from || filters.to
            ? { gte: filters.from, lte: filters.to }
            : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }

  reservationsByUser(userId: string, filters: ReservationFilters) {
    return this.prisma.reservation.findMany({
      where: {
        userId,
        reservedAt:
          filters.from || filters.to
            ? { gte: filters.from, lte: filters.to }
            : undefined,
      },
      include: { bookCopy: { include: { book: true } }, user: true },
      orderBy: { reservedAt: 'desc' },
    });
  }
}
