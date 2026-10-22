import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { API_BASE_URL } from './api-endpoint';
import { WebIdentityService } from './web-identity.service';
import { AuthenticationUnavailableError } from './authentication-unavailable.error';

const installationId = 'a20e47cf-a002-4b01-a001-000000000001';
const userId = 'a20e47cf-a002-4b01-a001-000000000002';
const token = 'carrim_' + 'A'.repeat(43);
const response = {
  installationId,
  userId,
  accountType: 'ANONYMOUS',
  accessToken: token,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe('persistent web identity', () => {
  let owner: string | null;
  let verify: ReturnType<typeof vi.fn>;
  let http: HttpTestingController;
  let service: WebIdentityService;
  beforeEach(() => {
    owner = null;
    verify = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        {
          provide: DatabaseService,
          useValue: {
            query: async () => (owner ? [{ value: owner }] : []),
            verifySyncOwner: verify,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(WebIdentityService);
  });
  afterEach(() => http.verify());
  const tick = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it('persists the HttpOnly proof first, binds SQLite and caches only the Bearer in memory', async () => {
    const pending = service.accessToken();
    const same = service.accessToken();
    await tick();
    const prepare = http.expectOne('/api/v1/auth/web/prepare');
    expect(prepare.request.body).toEqual({ installationId: null });
    expect(prepare.request.credentials).toBe('same-origin');
    expect(prepare.request.headers.get('X-Carrim-Web')).toBe('1');
    expect(prepare.request.redirect).toBe('error');
    prepare.flush({ installationId });
    await tick();
    const exchange = http.expectOne('/api/v1/auth/web/token');
    expect(exchange.request.body).toEqual({ installationId });
    exchange.flush(response);
    expect(await pending).toBe(token);
    expect(await same).toBe(token);
    expect(verify.mock.calls).toEqual([
      [installationId, undefined],
      [installationId, userId, true],
    ]);
    expect(await service.accessToken()).toBe(token);
    http.expectNone('/api/v1/auth/web/prepare');
  });

  it('sends the existing owner before renewal and rejects a replaced cookie without binding', async () => {
    owner = JSON.stringify({ installationId, userId });
    const pending = service.accessToken().catch((e) => e);
    await tick();
    const prepare = http.expectOne('/api/v1/auth/web/prepare');
    expect(prepare.request.body).toEqual({ installationId });
    prepare.flush({ installationId: userId });
    expect(await pending).toBeInstanceOf(Error);
    expect(await pending).not.toBeInstanceOf(AuthenticationUnavailableError);
    expect(verify).not.toHaveBeenCalled();
    http.expectNone('/api/v1/auth/web/token');
  });

  it('keeps a bound database intact when the cookie is missing', async () => {
    owner = JSON.stringify({ installationId, userId });
    const pending = service.accessToken().catch((e) => e);
    await tick();
    http.expectOne('/api/v1/auth/web/prepare').flush({}, { status: 409, statusText: 'Conflict' });
    expect(await pending).toBeInstanceOf(Error);
    expect(await pending).not.toBeInstanceOf(AuthenticationUnavailableError);
    expect(verify).not.toHaveBeenCalled();
  });

  it('blocks corrupt ownership before HTTP and refuses a foreign server identity', async () => {
    owner = '{}';
    await expect(service.accessToken()).rejects.toThrow();
    http.expectNone('/api/v1/auth/web/prepare');
    owner = JSON.stringify({ installationId, userId });
    const pending = service.accessToken().catch((e) => e);
    await tick();
    http.expectOne('/api/v1/auth/web/prepare').flush({ installationId });
    await tick();
    http.expectOne('/api/v1/auth/web/token').flush({ ...response, userId: installationId });
    expect(await pending).toBeInstanceOf(Error);
    expect(await pending).not.toBeInstanceOf(AuthenticationUnavailableError);
    expect(verify).not.toHaveBeenCalledWith(installationId, installationId, true);
  });

  it.each([0, 408, 429, 503])(
    'preserves retry status %s from web prepare and token renewal without leaking the response',
    async (status) => {
      const initial = service.accessToken().catch((error) => error);
      await tick();
      http
        .expectOne('/api/v1/auth/web/prepare')
        .flush({ private: token }, { status, statusText: 'Unavailable' });
      const initialFailure = await initial;
      expect(initialFailure).toBeInstanceOf(AuthenticationUnavailableError);
      expect(initialFailure.status).toBe(status);
      expect(initialFailure.error).toBeUndefined();
      expect(initialFailure.cause).toBeUndefined();
      expect(JSON.stringify(initialFailure)).not.toContain(token);

      owner = JSON.stringify({ installationId, userId });
      const renewed = service.accessToken(token).catch((error) => error);
      await tick();
      http.expectOne('/api/v1/auth/web/prepare').flush({ installationId });
      await tick();
      http
        .expectOne('/api/v1/auth/web/token')
        .flush({ private: token }, { status, statusText: 'Unavailable' });
      const renewalFailure = await renewed;
      expect(renewalFailure).toBeInstanceOf(AuthenticationUnavailableError);
      expect(renewalFailure.status).toBe(status);
      expect(renewalFailure.cause).toBeUndefined();
      expect(JSON.stringify(renewalFailure)).not.toContain(token);
      expect(verify).not.toHaveBeenCalledWith(installationId, userId, true);
    },
  );

  it.each([401, 403, 409])('does not make web proof rejection %s retryable', async (status) => {
    owner = JSON.stringify({ installationId, userId });
    const pending = service.accessToken().catch((error) => error);
    await tick();
    http
      .expectOne('/api/v1/auth/web/prepare')
      .flush({ private: token }, { status, statusText: 'Rejected' });
    const failure = await pending;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AuthenticationUnavailableError);
    expect(failure.message).not.toContain(token);
    http.expectNone('/api/v1/auth/web/token');
  });
});
