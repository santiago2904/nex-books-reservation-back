import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async readiness() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }
}
