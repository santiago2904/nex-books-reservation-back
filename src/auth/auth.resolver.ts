import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterInput } from './dto/register.input';
import { LoginInput } from './dto/login.input';
import { AuthPayload } from './dto/auth-payload.output';
import { UserOutput } from '../users/dto/user.output';
import { UsersService } from '../users/users.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Resolver()
export class AuthResolver {
  constructor(
    private auth: AuthService,
    private users: UsersService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => AuthPayload)
  register(@Args('input') input: RegisterInput) {
    return this.auth.register(input);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput) {
    return this.auth.login(input.email, input.password);
  }

  @Query(() => UserOutput, { name: 'me' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.findById(user.userId);
  }
}
