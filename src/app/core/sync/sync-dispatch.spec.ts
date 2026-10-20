import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { API_BASE_URL } from '../api/api-endpoint';
import { SyncIdentityService } from '../api/sync-identity.service';
import { SyncTransportService, SyncDispatchDeferred, SyncRequest } from './sync-transport.service';

const request: SyncRequest = {
  operationId: 'op',
  aggregateId: 'market',
  aggregateType: 'SUPERMARKET',
  operation: 'CREATE',
  baseVersion: null,
  payload: { name: 'Mercado' },
};
describe('foreground HTTP dispatch boundary', () => {
  let accessToken: ReturnType<typeof vi.fn>;
  let transport: SyncTransportService;
  let http: HttpTestingController;
  const flush = async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  };
  beforeEach(() => {
    accessToken = vi.fn().mockResolvedValue('token');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: SyncIdentityService, useValue: { accessToken } },
      ],
    });
    transport = TestBed.inject(SyncTransportService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it.each(['push', 'pull'])(
    'does not dispatch %s after backgrounding during token retrieval',
    async (kind) => {
      let foreground = true;
      let resolve!: (token: string) => void;
      accessToken.mockImplementationOnce(
        () =>
          new Promise<string>((done) => {
            resolve = done;
          }),
      );
      const pending =
        kind === 'push'
          ? transport.push(request, () => foreground)
          : transport.pull(undefined, () => foreground);
      const failure = expect(pending).rejects.toBeInstanceOf(SyncDispatchDeferred);
      foreground = false;
      resolve('token');
      await failure;
      http.expectNone('/api/v1/sync/' + kind);
    },
  );
  it('does not start token renewal or replay after a backgrounded 401', async () => {
    let foreground = true;
    const pending = transport.push(request, () => foreground);
    const failure = expect(pending).rejects.toBeInstanceOf(SyncDispatchDeferred);
    await flush();
    const sent = http.expectOne('/api/v1/sync/push');
    foreground = false;
    sent.flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;
    expect(accessToken).toHaveBeenCalledTimes(1);
  });
});
