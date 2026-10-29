// A task's payload comes from the job table, not from the type system: a malformed one fails with a clear error
// before the task touches anything.
import { describe, expect, it } from 'vitest';
import { processImportTask } from '../src/worker.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

describe('a task payload', () => {
  const touched: string[] = [];
  const task = processImportTask(
    { processImport: async (id) => { touched.push(id); return []; } },
    { afterImport: async () => {} },
    { finished: async () => {} },
    quiet,
  );

  it.each([
    ['nothing', undefined],
    ['no id', {}],
    ['an id that is not a string', { importId: 42 }],
    ['an empty id', { importId: '' }],
  ])('with %s is refused', async (_, payload) => {
    await expect(task(payload)).rejects.toThrow('the job payload has no importId');
    expect(touched).toEqual([]);
  });

  it('with its id runs', async () => {
    await task({ importId: 'imp-1' });
    expect(touched).toEqual(['imp-1']);
  });
});
