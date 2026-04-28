import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { UserOutput } from './dto/user.output';
import { CreateUserInput } from './dto/create-user.input';
import { Roles } from '../common/decorators/roles.decorator';

@Resolver(() => UserOutput)
export class UsersResolver {
  constructor(private users: UsersService) {}

  @Roles('ADMIN')
  @Mutation(() => UserOutput)
  createUser(@Args('input') input: CreateUserInput) {
    return this.users.createUser(input);
  }
}
