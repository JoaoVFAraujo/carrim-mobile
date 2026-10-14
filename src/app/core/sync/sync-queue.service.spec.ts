import { retryDelay } from './sync-queue.service';

describe('persistent retry schedule', () => {
  it('backs off from two seconds to a bounded one hour', () => {
    expect(Array.from({ length: 9 }, (_, i) => retryDelay(i + 1))).toEqual([
      2000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000, 3600000,
    ]);
    expect(retryDelay(100)).toBe(3600000);
  });
});
