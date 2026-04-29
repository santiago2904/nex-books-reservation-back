import {
  Args,
  ID,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { BookCopy } from '@prisma/client';
import { BooksService } from './books.service';
import { BookOutput } from './dto/book.output';
import { BookCopyOutput } from './dto/book-copy.output';
import { CreateBookInput } from './dto/create-book.input';
import { UpdateBookInput } from './dto/update-book.input';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

interface BookWithCopies {
  copies?: BookCopy[];
}

@Resolver(() => BookOutput)
export class BooksResolver {
  constructor(private books: BooksService) {}

  @Public()
  @Query(() => [BookOutput], { name: 'books' })
  list(@Args('available', { nullable: true }) available?: boolean) {
    return this.books.findAll({ available });
  }

  @Public()
  @Query(() => BookOutput, { nullable: true, name: 'book' })
  byId(@Args('id', { type: () => ID }) id: string) {
    return this.books.findOne(id);
  }

  @Roles('ADMIN')
  @Mutation(() => BookOutput)
  createBook(@Args('input') input: CreateBookInput) {
    return this.books.create(input);
  }

  @Roles('ADMIN')
  @Mutation(() => BookOutput)
  updateBook(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateBookInput,
  ) {
    return this.books.update(id, input);
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  deleteBook(@Args('id', { type: () => ID }) id: string) {
    return this.books.remove(id);
  }

  @Roles('ADMIN')
  @Mutation(() => BookCopyOutput)
  addBookCopy(@Args('bookId', { type: () => ID }) bookId: string) {
    return this.books.addCopy(bookId);
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  removeBookCopy(@Args('copyId', { type: () => ID }) copyId: string) {
    return this.books.removeCopy(copyId);
  }

  @ResolveField(() => Int)
  totalCopies(@Parent() book: BookWithCopies): number {
    return book.copies?.length ?? 0;
  }

  @ResolveField(() => Int)
  availableCopies(@Parent() book: BookWithCopies): number {
    return (book.copies ?? []).filter((c) => c.status === 'AVAILABLE').length;
  }
}
