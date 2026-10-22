import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { CatalogLookupService } from './catalog-lookup.service';
import { API_BASE_URL } from '../../../core/api/api-endpoint';
import { SyncIdentityService } from '../../../core/api/sync-identity.service';

const code = '7891000100103';
const route = '/api/v1/products/lookup/' + code;
const image =
  'https://images.openfoodfacts.org/images/products/789/100/010/0103/front_pt.3.200.jpg';
const response = () => ({
  status: 'FOUND',
  barcode: code,
  source: 'OPEN_FOOD_FACTS',
  name: 'Leite Moça',
  brand: 'Nestlé',
  quantity: '395 g',
  imageUrl: image,
  sourceUrl: 'https://evil.test',
  licenseUrl: 'javascript:alert(1)',
  measurementType: null,
});

describe('read-only authenticated catalog lookup', () => {
  it('accepts the approved Carrim catalog without trusting an external image or credit URL', async () => {
    const { service, http, abort, accessToken } = setup();
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    http
      .expectOne(route)
      .flush({ ...response(), source: 'CARRIM_APPROVED', name: 'Aveia aprovada' });
    expect(await result).toMatchObject({
      source: 'CARRIM_APPROVED',
      name: 'Aveia aprovada',
      imageUrl: null,
      sourceUrl: null,
      licenseUrl: null,
    });
  });
  function setup(base: string | null = '/api/v1') {
    const accessToken = vi.fn().mockResolvedValue('token');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: base },
        { provide: SyncIdentityService, useValue: { accessToken } },
      ],
    });
    return {
      service: TestBed.inject(CatalogLookupService),
      http: TestBed.inject(HttpTestingController),
      accessToken,
      abort: new AbortController(),
    };
  }
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });

  it('uses the owner boundary and safe HTTP settings, keeping only permitted fields and fixed credit links', async () => {
    const { service, http, abort, accessToken } = setup();
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    const req = http.expectOne(route);
    expect(req.request.headers.get('Authorization')).toBe('Bearer token');
    expect(req.request.credentials).toBe('omit');
    expect(req.request.redirect).toBe('error');
    expect(req.request.cache).toBe('no-store');
    expect(req.request.timeout).toBe(8000);
    req.flush(response());
    expect(await result).toMatchObject({
      status: 'FOUND',
      name: 'Leite Moça',
      imageUrl: image,
      sourceUrl: 'https://world.openfoodfacts.org/product/' + code,
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    });
  });

  it('renews once on 401 and does not retry other failures', async () => {
    const { service, http, abort, accessToken } = setup();
    accessToken.mockResolvedValueOnce('old').mockResolvedValue('new');
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledTimes(1));
    http.expectOne(route).flush({}, { status: 401, statusText: 'Unauthorized' });
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalledWith('old'));
    const retry = http.expectOne(route);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({}, { status: 429, statusText: 'Too many requests' });
    expect((await result).status).toBe('RATE_LIMITED');
    expect(accessToken).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://images.openfoodfacts.org/x.jpg',
    'https://evil.test/a.jpg',
    'https://images.openfoodfacts.org@evil.test/a.jpg',
    'https://images.openfoodfacts.org/images/products/123/front.jpg?token=x',
  ])('rejects unsafe image %s without blocking usable text', async (url) => {
    const { service, http, abort, accessToken } = setup();
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    http.expectOne(route).flush({ ...response(), imageUrl: url });
    expect(await result).toMatchObject({ status: 'FOUND', imageUrl: null });
  });

  it.each([
    { ...response(), barcode: '3017620422003' },
    { ...response(), name: 'x'.repeat(121) },
    { ...response(), source: 'UNKNOWN' },
    { ...response(), measurementType: 'KG' },
    { ...response(), name: { html: 'bad' } },
  ])('rejects malformed/mismatched responses', async (value) => {
    const { service, http, abort, accessToken } = setup();
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    http.expectOne(route).flush(value);
    expect((await result).status).toBe('UNAVAILABLE');
  });

  it('does not create another identity or issue HTTP when disabled', async () => {
    const { service, abort, accessToken } = setup(null);
    expect((await service.lookup(code, abort.signal)).status).toBe('DISABLED');
    expect(accessToken).not.toHaveBeenCalled();
  });

  it('keeps manual entry available offline or when identity cannot be confirmed', async () => {
    const { service, abort, accessToken } = setup();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect((await service.lookup(code, abort.signal)).status).toBe('UNAVAILABLE');
    expect(accessToken).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    accessToken.mockRejectedValue(new Error('private identity detail'));
    expect((await service.lookup(code, abort.signal)).status).toBe('UNAVAILABLE');
  });

  it('cancels the in-flight HTTP subscription when the page leaves', async () => {
    const { service, http, abort, accessToken } = setup();
    const result = service.lookup(code, abort.signal);
    await vi.waitFor(() => expect(accessToken).toHaveBeenCalled());
    const req = http.expectOne(route);
    abort.abort();
    expect((await result).status).toBe('UNAVAILABLE');
    expect(req.cancelled).toBe(true);
  });

  it('does not dispatch after slow identity preparation if cancelled', async () => {
    const { service, abort, accessToken } = setup();
    let resolve!: (value: string) => void;
    accessToken.mockImplementation(() => new Promise((done) => (resolve = done)));
    const result = service.lookup(code, abort.signal);
    abort.abort();
    resolve('late');
    expect((await result).status).toBe('UNAVAILABLE');
  });
});
