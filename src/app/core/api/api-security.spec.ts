import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { CredentialVault, NATIVE_CREDENTIAL_STORAGE } from './credential-vault';
import { AnonymousIdentityService } from './anonymous-identity.service';
import { CarrimApiService } from './carrim-api.service';
import { API_BASE_URL, apiEndpoint } from './api-endpoint';

const installationId = 'a20e47cf-a002-4b01-a001-000000000001';
const userId = 'a20e47cf-a002-4b01-a001-000000000002';
const oldToken = 'carrim_' + 'a'.repeat(43);
const newToken = 'carrim_' + 'b'.repeat(43);
const proof = 'A'.repeat(43);
const response = (id = installationId, accessToken = newToken) => ({
  installationId: id,
  userId,
  accountType: 'ANONYMOUS',
  accessToken,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

describe('credential storage boundaries', () => {
  let native: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  const vault = () => TestBed.runInInjectionContext(() => new CredentialVault());
  beforeEach(() => {
    native = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_CREDENTIAL_STORAGE, useValue: native }],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps browser credentials only in memory without invoking plugin or localStorage', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    const storage = vault();
    await storage.write('private');
    expect(await storage.read()).toBe('private');
    expect(await vault().read()).toBeNull();
    expect(native.get).not.toHaveBeenCalled();
    expect(native.set).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
  });

  it('uses native secure storage without cloud sync or migration to another device', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    native.get.mockResolvedValue('private');
    const storage = vault();
    await storage.write('private');
    expect(native.set).toHaveBeenCalledWith(
      'br.com.carrim.identity.v1',
      'private',
      false,
      false,
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
    expect(await storage.read()).toBe('private');
  });

  it('does not fall back to plaintext or propagate plugin secrets after a native failure', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    native.set.mockRejectedValue(new Error('secret debug data'));
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    await expect(vault().write('secret')).rejects.toThrow('Não foi possível salvar');
    expect(localWrite).not.toHaveBeenCalled();
  });
});

describe('API identity security', () => {
  let http: HttpTestingController;
  let identity: AnonymousIdentityService;
  let api: CarrimApiService;
  let stored: string | null;
  let write: ReturnType<typeof vi.fn>;
  let read: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = null;
    read = vi.fn(async () => stored);
    write = vi.fn(async (value: string) => {
      stored = value;
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: CredentialVault, useValue: { read, write } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    identity = TestBed.inject(AnonymousIdentityService);
    api = TestBed.inject(CarrimApiService);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });
  const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };

  it('persists cryptographic proof before bootstrap and shares concurrent renewal', async () => {
    const first = identity.accessToken();
    const second = identity.accessToken();
    expect(first).toBe(second);
    await tick();
    const request = http.expectOne('/api/v1/auth/anonymous');
    const saved = JSON.parse(stored!);
    expect(saved.installationSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.request.body.installationSecret).toBe(saved.installationSecret);
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(request.request.credentials).toBe('omit');
    expect(request.request.redirect).toBe('error');
    request.flush(response(saved.installationId));
    expect(await first).toBe(newToken);
    expect(await second).toBe(newToken);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('recovers the same installation after a lost response without leaking error bodies', async () => {
    const first = identity.accessToken();
    const failure = expect(first).rejects.toThrow('Não foi possível conectar com segurança');
    await tick();
    const request = http.expectOne('/api/v1/auth/anonymous');
    const initial = request.request.body;
    request.flush({ secret: proof }, { status: 503, statusText: 'Unavailable' });
    await failure;
    const retry = identity.accessToken();
    await tick();
    const recovered = http.expectOne('/api/v1/auth/anonymous');
    expect(recovered.request.body).toEqual(initial);
    recovered.flush(response(initial.installationId));
    expect(await retry).toBe(newToken);
  });

  it('refuses corrupt credentials without replacing their owner', async () => {
    stored = '{}';
    await expect(identity.accessToken()).rejects.toThrow('precisa ser recuperada');
    expect(write).not.toHaveBeenCalled();
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('never starts HTTP when saving the installation proof fails', async () => {
    write.mockRejectedValue(new Error('storage unavailable'));
    await expect(identity.accessToken()).rejects.toThrow('storage unavailable');
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('rejects a server response that changes the existing owner', async () => {
    stored = JSON.stringify({ installationId, installationSecret: proof, userId });
    const pending = identity.accessToken();
    const failure = expect(pending).rejects.toThrow('resposta de identidade');
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush({ ...response(), userId: installationId });
    await failure;
    expect(write).not.toHaveBeenCalled();
  });

  it('does not release a token if secure persistence fails after bootstrap', async () => {
    stored = JSON.stringify({ installationId, installationSecret: proof });
    write.mockRejectedValue(new Error('storage unavailable'));
    const pending = identity.accessToken();
    const failure = expect(pending).rejects.toThrow('storage unavailable');
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush(response());
    await failure;
    expect(JSON.parse(stored!).accessToken).toBeUndefined();
  });

  it('renews once on 401 and replays only a read, with redirect and cookies disabled', async () => {
    stored = JSON.stringify({
      installationId,
      installationSecret: proof,
      userId,
      accessToken: oldToken,
      expiresAt: response().expiresAt,
    });
    const pending = api.get('/auth/me');
    await tick();
    const rejected = http.expectOne('/api/v1/auth/me');
    expect(rejected.request.headers.get('Authorization')).toBe('Bearer ' + oldToken);
    expect(rejected.request.redirect).toBe('error');
    expect(rejected.request.credentials).toBe('omit');
    rejected.flush({}, { status: 401, statusText: 'Unauthorized' });
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush(response());
    await tick();
    const replay = http.expectOne('/api/v1/auth/me');
    expect(replay.request.headers.get('Authorization')).toBe('Bearer ' + newToken);
    replay.flush({ userId });
    expect(await pending).toEqual({ userId });
  });

  it('does not renew or retry permission errors', async () => {
    stored = JSON.stringify({
      installationId,
      installationSecret: proof,
      userId,
      accessToken: oldToken,
      expiresAt: response().expiresAt,
    });
    const pending = api.get('/products');
    const failure = expect(pending).rejects.toThrow('Não foi possível consultar');
    await tick();
    http.expectOne('/api/v1/products').flush({}, { status: 403, statusText: 'Forbidden' });
    await failure;
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('stops after one renewal when the replacement token is also rejected', async () => {
    stored = JSON.stringify({
      installationId,
      installationSecret: proof,
      userId,
      accessToken: oldToken,
      expiresAt: response().expiresAt,
    });
    const pending = api.get('/auth/me');
    const failure = expect(pending).rejects.toThrow('após renovar');
    await tick();
    http.expectOne('/api/v1/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush(response());
    await tick();
    http.expectOne('/api/v1/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('reuses the new token for a late 401 from the old token instead of revoking it again', async () => {
    stored = JSON.stringify({
      installationId,
      installationSecret: proof,
      userId,
      accessToken: oldToken,
      expiresAt: response().expiresAt,
    });
    const pending = identity.accessToken(oldToken);
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush(response());
    expect(await pending).toBe(newToken);
    expect(await identity.accessToken(oldToken)).toBe(newToken);
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('forces one renewal when concurrent 401 handlers join a pending cached-token lookup', async () => {
    stored = JSON.stringify({
      installationId,
      installationSecret: proof,
      userId,
      accessToken: oldToken,
      expiresAt: response().expiresAt,
    });
    let release!: (value: string | null) => void;
    read.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    const ordinary = identity.accessToken();
    const forced = identity.accessToken(oldToken);
    const concurrent = identity.accessToken(oldToken);
    release(stored);
    expect(await ordinary).toBe(oldToken);
    await tick();
    http.expectOne('/api/v1/auth/anonymous').flush(response());
    expect(await forced).toBe(newToken);
    expect(await concurrent).toBe(newToken);
    http.expectNone('/api/v1/auth/anonymous');
  });

  it('rejects external paths before reading credentials or starting HTTP', async () => {
    await expect(api.get('https://external.example/products')).rejects.toThrow('Caminho');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('endpoint configuration', () => {
  it('accepts the development proxy or an explicitly configured HTTPS API', () => {
    expect(apiEndpoint('/api/v1', '/products')).toBe('/api/v1/products');
    expect(apiEndpoint('https://api.example/api/v1', '/products')).toBe(
      'https://api.example/api/v1/products',
    );
  });
  it('fails closed for disabled API, cleartext, embedded credentials and path escapes', () => {
    for (const base of [
      null,
      'http://api.example/api/v1',
      'https://user:secret@api.example/api/v1',
      'https://api.example/api/v1?secret=1',
    ]) {
      expect(() => apiEndpoint(base, '/products')).toThrow();
    }
    for (const path of [
      '//external.example',
      '/../products',
      '/products?secret=1',
      '/%2fexternal',
      '/products\\outside',
    ]) {
      expect(() => apiEndpoint('/api/v1', path)).toThrow();
    }
  });
});
