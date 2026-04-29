import { Field, ID, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID } from 'class-validator';

@InputType()
export class CreateReservationInput {
  @Field(() => ID) @IsUUID() bookId!: string;

  @Field()
  @IsDate()
  @Type(() => Date)
  dueDate!: Date;

  @Field(() => String, { nullable: true }) @IsOptional() @IsString() idempotencyKey?: string;
}
