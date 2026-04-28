import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsEnum, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

@InputType()
export class CreateUserInput {
  @Field() @IsString() @MinLength(2) name!: string;
  @Field() @IsEmail() email!: string;

  @Field()
  @IsString()
  @MinLength(8)
  @Matches(/[A-Za-z]/, { message: 'password must contain a letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  password!: string;

  @Field(() => Role) @IsEnum(Role) role!: Role;
}
