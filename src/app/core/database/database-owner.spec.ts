import { DatabaseService } from './database.service';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

describe('persistent local owner', () => {
  let service: DatabaseService;
  let stored: string | undefined;
  let execute: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    stored = undefined;
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    service = new DatabaseService();
    execute = vi.fn(async (statements) => {
      stored = statements[0].values[1];
    });
    // Only the plugin connection is replaced; serial checks and binding run unchanged.
    Object.assign(service, {
      opening: Promise.resolve(),
      database: {
        query: async () => ({ values: stored === undefined ? [] : [{ value: stored }] }),
        executeSet: execute,
      },
    });
  });
  afterEach(() => vi.restoreAllMocks());
  it('preserves the owner across service recreation and rejects replacement identity', async () => {
    await service.verifySyncOwner('installation', 'owner', true);
    const restored = new DatabaseService();
    Object.assign(restored, {
      opening: Promise.resolve(),
      database: {
        query: async () => ({ values: [{ value: stored }] }),
        executeSet: execute,
      },
    });
    await restored.verifySyncOwner('installation', 'owner', true);
    await expect(restored.verifySyncOwner('other', 'other', true)).rejects.toThrow('proprietário');
    await expect(restored.verifySyncOwner('', undefined)).rejects.toThrow('proprietário');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stored!)).toEqual({ installationId: 'installation', userId: 'owner' });
  });
  it('serializes competing first bindings and keeps the first owner', async () => {
    const outcomes = await Promise.allSettled([
      service.verifySyncOwner('a', 'first', true),
      service.verifySyncOwner('b', 'second', true),
    ]);
    expect(outcomes.map((x) => x.status)).toEqual(['fulfilled', 'rejected']);
    expect(JSON.parse(stored!).userId).toBe('first');
  });
  it('leaves unbound databases unchanged during preflight and refuses corrupt bindings', async () => {
    await service.verifySyncOwner('', undefined);
    expect(execute).not.toHaveBeenCalled();
    stored = 'null';
    await expect(service.verifySyncOwner('a', 'owner', true)).rejects.toThrow('proprietário');
    stored = '{';
    await expect(service.verifySyncOwner('a', 'owner', true)).rejects.toThrow('recuperado');
    expect(execute).not.toHaveBeenCalled();
  });
});
