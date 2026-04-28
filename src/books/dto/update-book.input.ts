import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, MinLength } from 'class-validator';

@InputType()
export class UpdateBookInput {
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() @MinLength(1) title?: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() @MinLength(1) author?: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() isbn?: string;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() description?: string;
}
