import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { PhotoCaptureService, PHOTO_CAMERA, PHOTO_APP } from './photo-capture.service';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';
import { DatabaseService } from '../../../core/database/database.service';

describe('native photo capture boundaries', () => {
  const prepared = {
    imageBase64: '/9j/2Q==',
    contentType: 'image/jpeg' as const,
    width: 1,
    height: 1,
  };
  function setup() {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const prepare = vi.fn().mockResolvedValue(prepared),
      transaction = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: PHOTO_CAMERA, useValue: { getPhoto: vi.fn() } },
        {
          provide: PHOTO_APP,
          useValue: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
        },
        { provide: ProductPhotoService, useValue: { prepare } },
        {
          provide: DatabaseService,
          useValue: { query: vi.fn().mockResolvedValue([]), transaction },
        },
      ],
    });
    return { service: TestBed.inject(PhotoCaptureService), prepare, transaction };
  }
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('uses a local native URI and does not save the original in the public gallery', async () => {
    const { service, prepare } = setup();
    vi.mocked(TestBed.inject(PHOTO_CAMERA).getPhoto).mockResolvedValue({
      webPath: location.origin + '/_capacitor_file_/photo.jpg',
      format: 'jpeg',
      saved: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }),
      }),
    );
    expect(await service.capture('CAMERA')).toEqual(prepared);
    expect(TestBed.inject(PHOTO_CAMERA).getPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        saveToGallery: false,
        correctOrientation: true,
        width: 1024,
        height: 1024,
      }),
    );
    expect(prepare).toHaveBeenCalledWith(expect.any(File));
  });
  it('rejects an unexpected remote URI before requesting any bytes', async () => {
    const { service, prepare } = setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(TestBed.inject(PHOTO_CAMERA).getPhoto).mockResolvedValue({
      webPath: 'https://untrusted.test/photo.jpg',
      format: 'jpeg',
      saved: false,
    });
    await expect(service.capture('GALLERY')).rejects.toThrow('origem');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('keeps a restored camera result as a local draft for explicit confirmation', async () => {
    const { service, transaction } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }),
      }),
    );
    service.start();
    const listener = vi.mocked(TestBed.inject(PHOTO_APP).addListener).mock.calls[0][1] as (
      event: unknown,
    ) => void;
    listener({
      pluginId: 'Camera',
      methodName: 'getPhoto',
      success: true,
      data: { webPath: location.origin + '/_capacitor_file_/photo.jpg' },
    });
    await vi.waitFor(() => expect(service.recovered()).toEqual(prepared));
    expect(transaction).toHaveBeenCalledWith([
      expect.objectContaining({ values: ['photo_camera_recovery', expect.any(String)] }),
    ]);
    // The draft is not automatically attached to a product or sent to the API.
    expect(transaction.mock.calls[0][0][0].statement).toContain('app_metadata');
  });
});
