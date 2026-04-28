import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { ResStatus } from '@prisma/client';
import { UserOutput } from '../../users/dto/user.output';
import { BookCopyOutput } from '../../books/dto/book-copy.output';

registerEnumType(ResStatus, { name: 'ResStatus' });

@ObjectType('Reservation')
export class ReservationOutput {
  @Field(() => ID) id!: string;
  @Field(() => UserOutput) user!: UserOutput;
  @Field(() => BookCopyOutput) bookCopy!: BookCopyOutput;
  @Field() reservedAt!: Date;
  @Field() dueDate!: Date;
  @Field(() => Date, { nullable: true }) returnedAt?: Date | null;
  @Field(() => ResStatus) status!: ResStatus;
}
