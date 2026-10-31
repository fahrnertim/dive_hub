import type { FormEvent } from 'react';

/** A submitted form's fields by name, the page's own submit prevented. */
export const formValues = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
};
