import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

@InputType()
export class CreateBookInput {
  @Field() @IsString() @MinLength(1) title!: string;
  @Field() @IsString() @MinLength(1) author!: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() isbn?: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() description?: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() coverUrl?: string;
  @Field(() => Int) @IsInt() @Min(1) initialCopies!: number;
}
