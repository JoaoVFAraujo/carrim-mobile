import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App, type AppPlugin } from '@capacitor/app';
import {
  Camera,
  CameraResultType,
  CameraSource,
  type Photo,
  type CameraPlugin,
} from '@capacitor/camera';
import {
  ProductPhotoService,
  type PreparedPhoto,
} from '../../../core/photos/product-photo.service';
import { DatabaseService } from '../../../core/database/database.service';

export const PHOTO_CAMERA = new InjectionToken<Pick<CameraPlugin, 'getPhoto'>>('photo camera', {
  providedIn: 'root',
  factory: () => ({ getPhoto: Camera.getPhoto.bind(Camera) }),
});
export const PHOTO_APP = new InjectionToken<Pick<AppPlugin, 'addListener'>>('photo app restore', {
  providedIn: 'root',
  factory: () => ({ addListener: App.addListener.bind(App) }),
});

@Injectable({ providedIn: 'root' })
export class PhotoCaptureService {
  private readonly photos = inject(ProductPhotoService);
  private readonly db = inject(DatabaseService);
  private readonly camera = inject(PHOTO_CAMERA);
  private readonly app = inject(PHOTO_APP);
  readonly recovered = signal<PreparedPhoto | null>(null);
  readonly native = Capacitor.isNativePlatform();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loadRecovered();
    if (this.native)
      void this.app
        .addListener('appRestoredResult', (event) => {
          if (event.pluginId === 'Camera' && event.methodName === 'getPhoto' && event.success) {
            void this.fromNative(event.data as Photo)
              .then(async (photo) => {
                await this.db.transaction([
                  {
                    statement:
                      'INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                    values: ['photo_camera_recovery', JSON.stringify({ photo, at: Date.now() })],
                  },
                ]);
                this.recovered.set(photo);
              })
              .catch(() => undefined);
          }
        })
        .catch(() => undefined);
  }

  async capture(source: 'CAMERA' | 'GALLERY'): Promise<PreparedPhoto> {
    const photo = await this.camera.getPhoto({
      source: source === 'CAMERA' ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 85,
      width: 1024,
      height: 1024,
      correctOrientation: true,
      saveToGallery: false,
    });
    return this.fromNative(photo);
  }

  private async fromNative(photo: Photo): Promise<PreparedPhoto> {
    if (!photo.webPath) throw new Error('Não foi possível abrir a foto.');
    const path = new URL(photo.webPath, location.href);
    if (
      path.origin !== location.origin ||
      !['http:', 'https:', 'capacitor:'].includes(path.protocol)
    )
      throw new Error('A origem da foto não é válida.');
    const response = await fetch(path.href, { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Não foi possível abrir a foto.');
    const blob = await response.blob();
    return this.photos.prepare(new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }));
  }

  private async loadRecovered(): Promise<void> {
    try {
      const rows = await this.db.query<{ value: string }>(
        'SELECT value FROM app_metadata WHERE key=?',
        ['photo_camera_recovery'],
      );
      if (!rows[0]) return;
      const value = JSON.parse(rows[0].value);
      if (
        Date.now() - value.at < 86400000 &&
        value.photo?.contentType === 'image/jpeg' &&
        typeof value.photo.imageBase64 === 'string' &&
        value.photo.imageBase64.length <= 700000
      )
        this.recovered.set(value.photo);
      else await this.discardRecovered();
    } catch {
      /* A camera draft cannot prevent purchases from opening. */
    }
  }

  async discardRecovered(): Promise<void> {
    this.recovered.set(null);
    await this.db.transaction([
      { statement: 'DELETE FROM app_metadata WHERE key=?', values: ['photo_camera_recovery'] },
    ]);
  }
}
