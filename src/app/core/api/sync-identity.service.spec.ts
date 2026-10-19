import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { AnonymousIdentityService } from './anonymous-identity.service';
import { CredentialVault } from './credential-vault';
import { WebIdentityService } from './web-identity.service';
import { SyncIdentityService } from './sync-identity.service';

const installationId = 'a20e47cf-a002-4b01-a001-000000000001';
const userId = 'a20e47cf-a002-4b01-a001-000000000002';

describe('sync identity boundary', () => {
  let stored: string | null;
  let verify: ReturnType<typeof vi.fn>;
  let obtain: ReturnType<typeof vi.fn>;
  let service: SyncIdentityService;
  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    stored = JSON.stringify({ installationId, userId, accessToken: 'token' });
    verify = vi.fn().mockResolvedValue(undefined);
    obtain = vi.fn().mockResolvedValue('token');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WebIdentityService,
          useValue: { accessToken: () => Promise.resolve('web-token') },
        },
        { provide: DatabaseService, useValue: { verifySyncOwner: verify } },
        { provide: CredentialVault, useValue: { read: async () => stored } },
        { provide: AnonymousIdentityService, useValue: { accessToken: obtain } },
      ],
    });
    service = TestBed.inject(SyncIdentityService);
  });
  afterEach(() => vi.restoreAllMocks());

  it('checks ownership before authentication and persists it before returning a token', async () => {
    expect(await service.accessToken('rejected')).toBe('token');
    expect(verify.mock.calls).toEqual([
      [installationId, userId],
      [installationId, userId, true],
    ]);
    expect(verify.mock.invocationCallOrder[0]).toBeLessThan(obtain.mock.invocationCallOrder[0]);
    expect(obtain).toHaveBeenCalledWith('rejected');
  });
  it('delegates browser synchronization to the HttpOnly identity boundary', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    expect(await service.accessToken()).toBe('web-token');
    expect(obtain).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it('blocks missing credentials on a bound database before creating a replacement identity', async () => {
    stored = null;
    verify.mockRejectedValue(new Error('proprietário'));
    await expect(service.accessToken()).rejects.toThrow('proprietário');
    expect(obtain).not.toHaveBeenCalled();
  });
  it('rejects corrupt credentials before HTTP', async () => {
    stored = '{}';
    await expect(service.accessToken()).rejects.toThrow('recuperada');
    expect(obtain).not.toHaveBeenCalled();
  });
  it('does not release a token when owner persistence fails', async () => {
    verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk'));
    await expect(service.accessToken()).rejects.toThrow('disk');
  });
  it('binds a fresh installation only after successful bootstrap', async () => {
    stored = null;
    obtain.mockImplementation(async () => {
      stored = JSON.stringify({ installationId, userId, accessToken: 'token' });
      return 'token';
    });
    expect(await service.accessToken()).toBe('token');
    expect(verify.mock.calls).toEqual([
      ['', undefined],
      [installationId, userId, true],
    ]);
  });
});
