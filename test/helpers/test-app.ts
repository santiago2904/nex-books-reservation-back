import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaExceptionFilter } from '../../src/common/filters/prisma-exception.filter';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  container: StartedPostgreSqlContainer;
}

export async function setupTestApp(): Promise<TestContext> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('nex_test')
    .withUsername('nex')
    .withPassword('nex')
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = 'test-secret-of-at-least-32-characters-long-x';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.NODE_ENV = 'test';
  process.env.CORS_ORIGIN = 'http://localhost:5173';

  execSync('pnpm prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma, container };
}

export async function teardownTestApp(ctx: TestContext) {
  await ctx.app.close();
  await ctx.container.stop();
}
