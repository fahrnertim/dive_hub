import { describe, expect, it } from 'vitest';
import { LOCAL_TEST_DATABASE_URL, resolveTestDatabaseUrl } from './test-database-url.js';

describe('the test database server', () => {
  it('uses DIVEHUB_TEST_DATABASE_URL when set', () => {
    expect(resolveTestDatabaseUrl({
      DIVEHUB_TEST_DATABASE_URL: 'postgres://divehub:secret@divehub-db:5432/divehub',
      TEST_DATABASE_URL: 'postgres://old:secret@old-test-db:5432/divehub',
      DATABASE_URL: 'postgres://app:secret@paperclip-db:5432/paperclip',
    })).toBe('postgres://divehub:secret@divehub-db:5432/divehub');
  });

  it('falls back to TEST_DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://old:secret@old-test-db:5432/divehub' }))
      .toBe('postgres://old:secret@old-test-db:5432/divehub');
  });

  it('never uses the application database from DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: 'postgres://app:secret@paperclip-db:5432/paperclip' }))
      .toBe(LOCAL_TEST_DATABASE_URL);
  });

  it('treats an empty test URL as unset', () => {
    expect(resolveTestDatabaseUrl({ DIVEHUB_TEST_DATABASE_URL: '  ', DATABASE_URL: 'postgres://app:secret@paperclip-db:5432/paperclip' }))
      .toBe(LOCAL_TEST_DATABASE_URL);
  });
});
