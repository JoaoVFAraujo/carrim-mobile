import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { TimeoutError } from 'rxjs';
import { API_BASE_URL } from '../api/api-endpoint';
import { SyncIdentityService } from '../api/sync-identity.service';
import { AuthenticationUnavailableError } from '../api/authentication-unavailable.error';
import { PhotoTransportService } from './photo-transport.service';

describe('photo HTTP ownership and transport boundaries', () => {
  const id = 'a0000000-0000-4000-8000-000000000001';
  function setup() {
    const accessToken = vi.fn().mockResolvedValue('owner-token');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: SyncIdentityService, useValue: { accessToken } },
      ],
    });
    return {
      service: TestBed.inject(PhotoTransportService),
      http: TestBed.inject(HttpTestingController),
      accessToken,
    };
  }
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('uses the bound business identity, omits cookies and rejects redirects without an admin credential', async () => {
    const { service, http, accessToken } = setup();
    const body = { imageBase64: '/9j/2Q==', contentType: 'image/jpeg' };
    const pending = service.request('PUT', '/products/photos/' + id, body);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledTimes(1));
    const req = http.expectOne('/api/v1/products/photos/' + id);
    expect(req.request.headers.get('Authorization')).toBe('Bearer owner-token');
    expect(req.request.headers.has('X-Carrim-Photo-Admin')).toBe(false);
    expect(req.request.credentials).toBe('omit');
    expect(req.request.redirect).toBe('error');
    expect(req.request.cache).toBe('no-store');
    expect(req.request.timeout).toBe(15000);
    expect(req.request.body).toEqual(body);
    req.flush({ id, status: 'PENDING' });
    expect(await pending).toEqual({ id, status: 'PENDING' });
  });

  it('renews once through the same ownership boundary and leaves rate limiting to the durable retry queue', async () => {
    const { service, http, accessToken } = setup();
    accessToken.mockResolvedValueOnce('old-token').mockResolvedValue('new-token');
    const pending = service.request('GET', '/products/photos/' + id);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledTimes(1));
    http
      .expectOne('/api/v1/products/photos/' + id)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledWith('old-token'));
    const second = http.expectOne('/api/v1/products/photos/' + id);
    expect(second.request.headers.get('Authorization')).toBe('Bearer new-token');
    second.flush({}, { status: 429, statusText: 'Too many requests' });
    await expect(pending).rejects.toMatchObject({ status: 429, transient: true });
    expect(accessToken).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch an image request after the app backgrounds during token preparation', async () => {
    const { service, accessToken } = setup();
    let complete!: (value: string) => void;
    let foreground = true;
    accessToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = service.image(id, () => foreground);
    foreground = false;
    complete('late-token');
    await expect(pending).rejects.toMatchObject({ status: 0 });
  });

  it('accepts only bounded JPEG response content for the local image cache', async () => {
    const { service, http, accessToken } = setup();
    const pending = service.image(id);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    const req = http.expectOne('/api/v1/products/photos/' + id + '/content');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['<svg>untrusted</svg>'], { type: 'image/svg+xml' }));
    await expect(pending).rejects.toMatchObject({ status: 422, transient: false });
  });

  it('does not bypass an identity mismatch or expose its diagnostic details', async () => {
    const { service, accessToken } = setup();
    accessToken.mockRejectedValue(new Error('private diagnostic detail'));
    await expect(service.request('GET', '/products/photos/' + id)).rejects.toMatchObject({
      status: 403,
      message: 'Não foi possível sincronizar a foto agora.',
    });
  });

  it.each([0, 408, 429, 500, 503])(
    'retains transient identity HTTP failure %s for the durable retry queue',
    async (status) => {
      const { service, accessToken } = setup();
      accessToken.mockRejectedValue(
        new HttpErrorResponse({ status, error: { secret: 'private' } }),
      );
      await expect(service.request('PUT', '/products/photos/' + id, {})).rejects.toMatchObject({
        status,
        transient: true,
        message: 'Não foi possível sincronizar a foto agora.',
      });
    },
  );

  it('retains an identity preparation timeout for retry without dispatching media', async () => {
    const { service, accessToken } = setup();
    accessToken.mockRejectedValue(new TimeoutError());
    await expect(service.request('PUT', '/products/photos/' + id, {})).rejects.toMatchObject({
      status: 408,
      transient: true,
    });
  });

  it.each([401, 403, 404, 409])(
    'does not retry identity rejection or configuration HTTP failure %s',
    async (status) => {
      const { service, accessToken } = setup();
      accessToken.mockRejectedValue(
        new HttpErrorResponse({ status, error: { secret: 'private' } }),
      );
      await expect(service.request('PUT', '/products/photos/' + id, {})).rejects.toMatchObject({
        status: 403,
        transient: false,
      });
    },
  );

  it.each([
    new TimeoutError(),
    new HttpErrorResponse({ status: 503 }),
    new AuthenticationUnavailableError(429),
  ])('retains a transient identity renewal failure after a media 401', async (failure) => {
    const { service, http, accessToken } = setup();
    accessToken.mockResolvedValueOnce('old-token').mockRejectedValue(failure);
    const pending = service.request('PUT', '/products/photos/' + id, {});
    const rejected = expect(pending).rejects.toMatchObject({ transient: true });
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledTimes(1));
    http
      .expectOne('/api/v1/products/photos/' + id)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await rejected;
    expect(accessToken).toHaveBeenCalledWith('old-token');
    expect(accessToken).toHaveBeenCalledTimes(2);
  });

  it.each([
    'A identidade não corresponde ao proprietário das compras locais.',
    'A identidade salva precisa ser recuperada antes de sincronizar.',
    'A conexão web exige API na mesma origem.',
  ])('keeps ownership, proof and configuration errors permanent: %s', async (message) => {
    const { service, accessToken } = setup();
    accessToken.mockRejectedValue(new Error(message));
    await expect(service.request('PUT', '/products/photos/' + id, {})).rejects.toMatchObject({
      status: 403,
      transient: false,
      message: 'Não foi possível sincronizar a foto agora.',
    });
  });

  it('encodes bounded preference pagination as query parameters rather than a GET body', async () => {
    const { service, http, accessToken } = setup();
    const pending = service.request('GET', '/products/photos/preferences', undefined, () => true, {
      limit: 100,
      offset: 100,
    });
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    const request = http.expectOne('/api/v1/products/photos/preferences?limit=100&offset=100');
    expect(request.request.params.get('offset')).toBe('100');
    expect(request.request.body).toBeNull();
    request.flush([]);
    expect(await pending).toEqual([]);
  });
});
