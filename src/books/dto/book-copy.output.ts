import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { CopyStatus } from '@prisma/client';

registerEnumType(CopyStatus, { name: 'CopyStatus' });

@ObjectType('BookCopy')
export class BookCopyOutput {
  @Field(() => ID) id!: string;
  @Field() code!: string;
  @Field(() => CopyStatus) status!: CopyStatus;
}
