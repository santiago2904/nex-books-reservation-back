import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ReservationsService } from './reservations.service';
import { ReservationOutput } from './dto/reservation.output';
import { CreateReservationInput } from './dto/create-reservation.input';
import { ReservationFiltersInput } from './dto/reservation-filters.input';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Resolver(() => ReservationOutput)
export class ReservationsResolver {
  constructor(private svc: ReservationsService) {}

  @Mutation(() => ReservationOutput)
  createReservation(
    @CurrentUser() user: AuthUser,
    @Args('input') input: CreateReservationInput,
  ) {
    return this.svc.create({
      userId: user.userId,
      bookId: input.bookId,
      dueDate: input.dueDate,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @Mutation(() => ReservationOutput)
  returnBook(
    @CurrentUser() user: AuthUser,
    @Args('reservationId', { type: () => ID }) reservationId: string,
  ) {
    return this.svc.returnBook(reservationId, {
      userId: user.userId,
      role: user.role,
    });
  }

  @Query(() => [ReservationOutput])
  myReservations(
    @CurrentUser() user: AuthUser,
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.myReservations(user.userId, filters ?? {});
  }

  @Roles('ADMIN')
  @Query(() => [ReservationOutput])
  reservationsByBook(
    @Args('bookId', { type: () => ID }) bookId: string,
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.reservationsByBook(bookId, filters ?? {});
  }

  @Roles('ADMIN')
  @Query(() => [ReservationOutput])
  reservationsByUser(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.reservationsByUser(userId, filters ?? {});
  }

  @Roles('ADMIN')
  @Query(() => [ReservationOutput])
  allReservations(
    @Args('filters', { nullable: true }) filters?: ReservationFiltersInput,
  ) {
    return this.svc.allReservations(filters ?? {});
  }
}
