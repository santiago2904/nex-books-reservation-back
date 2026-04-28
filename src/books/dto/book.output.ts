import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { BookCopyOutput } from './book-copy.output';

@ObjectType('Book')
export class BookOutput {
  @Field(() => ID) id!: string;
  @Field() title!: string;
  @Field() author!: string;
  @Field(() => String, { nullable: true }) isbn?: string | null;
  @Field(() => String, { nullable: true }) description?: string | null;
  @Field(() => Int) totalCopies!: number;
  @Field(() => Int) availableCopies!: number;
  @Field(() => [BookCopyOutput]) copies!: BookCopyOutput[];
  @Field() createdAt!: Date;
  @Field() updatedAt!: Date;
}
