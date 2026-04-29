import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<User> {
    const exists = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (exists) {
      throw new ConflictException({
        message: 'Email already exists',
        code: 'EMAIL_ALREADY_EXISTS',
      });
    }
    return this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
        role: input.role,
      },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
