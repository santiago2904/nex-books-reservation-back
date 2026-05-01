import { Module } from '@nestjs/common';
import { VoyagerController } from './voyager.controller';

@Module({ controllers: [VoyagerController] })
export class VoyagerModule {}
