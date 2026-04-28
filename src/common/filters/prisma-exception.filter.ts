import {
  ArgumentsHost,
  Catch,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements GqlExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, _host: ArgumentsHost) {
    if (error.code === 'P2002') {
      return new ConflictException({
        message: 'Resource conflict',
        code: 'RESOURCE_CONFLICT',
      });
    }
    if (error.code === 'P2025') {
      return new NotFoundException({
        message: 'Resource not found',
        code: 'NOT_FOUND',
      });
    }
    return error;
  }
}
