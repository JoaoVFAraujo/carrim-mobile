import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PhotoAdminService } from './photo-admin.service';
import { API_BASE_URL } from '../../../core/api/api-endpoint';

describe('photo administration boundary', () => {
  const id = 'a0000000-0000-4000-8000-000000000001';
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    return {
      service: TestBed.inject(PhotoAdminService),
      http: TestBed.inject(HttpTestingController),
    };
  }
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('keeps the admin key out of URLs, cookies, Bearer and business identity', async () => {
    const { service, http } = setup();
    service.login('a'.repeat(43));
    const pending = service.list('PENDING', 0);
    const req = http.expectOne('/api/v1/photo-admin/photos?status=PENDING&limit=20&offset=0');
    expect(req.request.headers.get('X-Carrim-Photo-Admin')).toBe('a'.repeat(43));
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.credentials).toBe('omit');
    expect(req.request.redirect).toBe('error');
    expect(req.request.cache).toBe('no-store');
    req.flush([{ id, name: 'Produto', version: 0, status: 'PENDING' }]);
    expect(await pending).toHaveLength(1);
    service.logout();
    await expect(service.list('PENDING', 0)).rejects.toThrow();
  });
  it('clears authorization on rejection and never echoes a response or credential', async () => {
    const { service, http } = setup();
    service.login('b'.repeat(43));
    const pending = service.list('PENDING', 0);
    http
      .expectOne('/api/v1/photo-admin/photos?status=PENDING&limit=20&offset=0')
      .flush({ secret: 'private' }, { status: 403, statusText: 'Forbidden' });
    await expect(pending).rejects.toThrow('Acesso não autorizado');
    await expect(service.list('PENDING', 0)).rejects.toThrow();
  });
  it('sends approval with the reviewed version and preserves conflict for reloading', async () => {
    const { service, http } = setup();
    service.login('c'.repeat(43));
    const pending = service.decide(
      {
        id,
        name: 'Produto',
        version: 4,
        status: 'PENDING',
        barcode: null,
        itemId: null,
        source: 'USER',
      },
      'APPROVE',
      '',
    );
    const req = http.expectOne('/api/v1/photo-admin/photos/' + id + '/decision');
    expect(req.request.body).toEqual({ decision: 'APPROVE', version: 4, reason: null });
    req.flush({}, { status: 409, statusText: 'Conflict' });
    await expect(pending).rejects.toThrow('mudou durante a revisão');
  });
  it('rejects untrusted list identifiers before displaying them as images', async () => {
    const { service, http } = setup();
    service.login('d'.repeat(43));
    const pending = service.list('PENDING', 0);
    http
      .expectOne('/api/v1/photo-admin/photos?status=PENDING&limit=20&offset=0')
      .flush([{ id: '../../other', name: 'Bad', version: 0 }]);
    await expect(pending).rejects.toThrow('Não foi possível');
  });
});
