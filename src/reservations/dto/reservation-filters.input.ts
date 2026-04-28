import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { ResStatus } from '@prisma/client';

@InputType()
export class ReservationFiltersInput {
  @Field(() => Date, { nullable: true }) @IsOptional() @IsDate() @Type(() => Date) from?: Date;
  @Field(() => Date, { nullable: true }) @IsOptional() @IsDate() @Type(() => Date) to?: Date;

  @Field(() => ResStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ResStatus)
  status?: ResStatus;
}
