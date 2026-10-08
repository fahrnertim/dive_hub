// The zip reader an uploaded archive goes through (ADR 0044): untrusted input, read one entry at a time.
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchiveLimitError, DEFAULT_LIMITS, eachFile, type ArchiveEntry } from '../src/imports/archive.js';
import { zipOf } from './zip.js';

describe('eachFile', () => {
  let dir: string;
  const stored = async (name: string, data: Buffer) => {
    const path = join(dir, name);
    await writeFile(path, data);
    return path;
  };
  const walk = async (path: string, visit: (e: ArchiveEntry) => Promise<void> | void = () => {}, limits = DEFAULT_LIMITS) => {
    const seen: ArchiveEntry[] = [];
    await eachFile(path, async (e) => { seen.push(e); await visit(e); }, limits);
    return seen;
  };

  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'divehub-archive-test-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('hands over every file, also those in a nested zip, numbered in the order they lie', async () => {
    const inner = await zipOf({ 'a.fit': 'first', 'b.fit': 'second' });
    const path = await stored('export.zip', await zipOf({ 'customer.json': '{}', 'DI_CONNECT/Uploaded/Part1.zip': inner, 'DI_CONNECT/last.json': '[]' }));
    const read: string[] = [];
    const seen = await walk(path, async (e) => { read.push((await e.read()).toString()); });
    expect(seen.map((e) => [e.index, e.name])).toEqual([[0, 'customer.json'], [1, 'Part1.zip/a.fit'], [2, 'Part1.zip/b.fit'], [3, 'last.json']]);
    expect(read).toEqual(['{}', 'first', 'second', '[]']);
  });

  it('numbers the files the same on a second walk, which can read only the ones it wants', async () => {
    const path = await stored('again.zip', await zipOf({ 'x.bin': 'x', 'nested.zip': await zipOf({ 'dive.fit': 'the dive' }), 'y.bin': 'y' }));
    const wanted = (await walk(path)).find((e) => e.name.endsWith('dive.fit'))!.index;
    const read: string[] = [];
    await walk(path, async (e) => { if (e.index === wanted) read.push((await e.read()).toString()); });
    expect(read).toEqual(['the dive']);
  });

  it('names a file by its base name only, and refuses an archive whose entries point outside it', async () => {
    const path = await stored('paths.zip', await zipOf({ 'deep/down/evil.fit': 'x' }));
    expect((await walk(path)).map((e) => e.name)).toEqual(['evil.fit']);
    // The zip writer refuses such names too, so the bytes are patched: `xx/yy` becomes `../..` in both headers.
    const honest = await zipOf({ 'xx/yy/outside/evil.fit': 'x' });
    const patched = Buffer.from(honest.toString('latin1').replaceAll('xx/yy/', '../../'), 'latin1');
    await expect(walk(await stored('slip.zip', patched))).rejects.toThrow(/invalid relative path/);
  });

  it('stops at the limit of files', async () => {
    const path = await stored('many.zip', await zipOf({ '1': 'a', '2': 'b', '3': 'c' }));
    await expect(walk(path, undefined, { ...DEFAULT_LIMITS, maxEntries: 2 })).rejects.toBeInstanceOf(ArchiveLimitError);
  });

  it('stops at the limit of unpacked bytes and at the nesting limit', async () => {
    const big = await stored('big.zip', await zipOf({ 'a.bin': Buffer.alloc(600, 1), 'b.bin': Buffer.alloc(600, 2) }));
    await expect(walk(big, undefined, { ...DEFAULT_LIMITS, maxTotalBytes: 1000, maxCompressionRatio: 1e6 })).rejects.toBeInstanceOf(ArchiveLimitError);
    const deep = await stored('deep.zip', await zipOf({ 'l2.zip': await zipOf({ 'l3.zip': await zipOf({ 'x': 'x' }) }) }));
    await expect(walk(deep, undefined, { ...DEFAULT_LIMITS, maxDepth: 2 })).rejects.toBeInstanceOf(ArchiveLimitError);
  });

  it('refuses a file that unpacks far beyond its packed size', async () => {
    const bomb = await stored('bomb.zip', await zipOf({ 'zeros.bin': Buffer.alloc(2_000_000) }));
    await expect(walk(bomb, async (e) => { await e.read(); })).rejects.toBeInstanceOf(ArchiveLimitError);
  });

  it('does not hand over a file larger than a dive file can be, and leaves no temporary files', async () => {
    const path = await stored('large.zip', await zipOf({ 'huge.bin': Buffer.from('0123456789'), 'n.zip': await zipOf({ 'ok.fit': 'ok' }) }));
    const before = (await readdir(tmpdir())).filter((n) => n.startsWith('divehub-zip-')).length;
    const seen = await walk(path, undefined, { ...DEFAULT_LIMITS, maxEntryBytes: 5 });
    expect(seen.map((e) => e.name)).toEqual(['n.zip/ok.fit']);
    expect((await readdir(tmpdir())).filter((n) => n.startsWith('divehub-zip-'))).toHaveLength(before);
  });
});
