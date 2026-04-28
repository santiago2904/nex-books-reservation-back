import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BooksModule } from './books/books.module';
import { ReservationsModule } from './reservations/reservations.module';
import { HealthModule } from './health/health.module';
import { JwtStrategy } from './auth/jwt.strategy';
import { GqlAuthGuard } from './auth/guards/gql-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    PrismaModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      playground: process.env.NODE_ENV !== 'production',
      sortSchema: true,
      context: ({ req }: { req: unknown }) => ({ req }),
    }),
    AuthModule,
    UsersModule,
    BooksModule,
    ReservationsModule,
    HealthModule,
  ],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: GqlAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
