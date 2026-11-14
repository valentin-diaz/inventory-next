/** One page of a DRF list endpoint that uses PageNumberPagination. */
export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
