import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Role } from '@prisma/client';

registerEnumType(Role, { name: 'Role' });

@ObjectType('User')
export class UserOutput {
  @Field(() => ID) id!: string;
  @Field() name!: string;
  @Field() email!: string;
  @Field(() => Role) role!: Role;
  @Field() createdAt!: Date;
}
