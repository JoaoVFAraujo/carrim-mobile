import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IonButton } from '@ionic/angular';
import {
  ProductPhotoService,
  type PreparedPhoto,
  type StoredPhoto,
} from '../../../core/photos/product-photo.service';
import { PhotoCaptureService } from '../../../features/photos/services/photo-capture.service';
import { ProductPhotoComponent } from '../product-photo/product-photo.component';

export type PhotoEdit =
  { kind: 'SET'; photo: PreparedPhoto } | { kind: 'REMOVE' } | { kind: 'RESTORE' };

@Component({
  selector: 'app-photo-editor',
  imports: [IonButton, ProductPhotoComponent],
  templateUrl: './photo-editor.component.html',
  styleUrl: './photo-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoEditorComponent {
  readonly barcode = input<string | null>(null);
  readonly itemId = input<string | null>(null);
  readonly name = input('Produto');
  readonly fallbackUrl = input<string | null>(null);
  readonly showPreview = input(true);
  readonly disabled = input(false);
  readonly changed = output<PhotoEdit>();
  readonly preparing = output<boolean>();
  readonly capture = inject(PhotoCaptureService);
  private readonly photos = inject(ProductPhotoService);
  readonly draft = signal<PreparedPhoto | null>(null);
  readonly existing = signal<StoredPhoto | null>(null);
  readonly removed = signal(false);
  readonly storedHidden = signal(false);
  readonly restoring = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  private request = 0;
  private queryRequest = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      ++this.request;
      ++this.queryRequest;
    });
    effect(() => {
      this.photos.revision();
      const target = { barcode: this.barcode(), itemId: this.barcode() ? null : this.itemId() };
      const request = ++this.queryRequest;
      if (!target.barcode && !target.itemId) {
        this.existing.set(null);
        this.storedHidden.set(false);
        return;
      }
      void Promise.all([this.photos.get(target), this.photos.hidden(target)])
        .then(([photo, hidden]) => {
          if (request === this.queryRequest) {
            this.existing.set(photo);
            this.storedHidden.set(hidden);
          }
        })
        .catch(() => undefined);
    });
  }
  preview(): string | null {
    return this.removed() || (!this.draft() && this.storedHidden() && !this.restoring())
      ? null
      : this.draft()
        ? 'data:image/jpeg;base64,' + this.draft()!.imageBase64
        : (this.existing()?.imageUrl ?? this.fallbackUrl());
  }
  async select(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.disabled() || this.busy()) return;
    await this.prepare(() => this.photos.prepare(file));
  }
  async take(source: 'CAMERA' | 'GALLERY'): Promise<void> {
    if (this.disabled() || this.busy()) return;
    await this.prepare(() => this.capture.capture(source));
  }
  private async prepare(work: () => Promise<PreparedPhoto>): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    this.preparing.emit(true);
    const request = ++this.request;
    try {
      const photo = await work();
      if (request !== this.request) return;
      this.draft.set(photo);
      this.removed.set(false);
      this.changed.emit({ kind: 'SET', photo });
    } catch (error) {
      if (request === this.request)
        this.message.set(
          error instanceof Error && /cancel/i.test(error.message)
            ? 'Seleção cancelada. A foto anterior foi mantida.'
            : 'Não foi possível usar a imagem. Escolha uma foto JPEG ou PNG válida.',
        );
    } finally {
      this.busy.set(false);
      this.preparing.emit(false);
    }
  }
  remove(): void {
    this.draft.set(null);
    this.removed.set(true);
    this.changed.emit({ kind: 'REMOVE' });
  }
  restore(): void {
    this.draft.set(null);
    this.removed.set(false);
    this.restoring.set(true);
    this.changed.emit({ kind: 'RESTORE' });
    this.message.set('A foto do catálogo será buscada ao salvar.');
  }
  useRecovered(): void {
    const photo = this.capture.recovered();
    if (!photo) return;
    this.draft.set(photo);
    this.removed.set(false);
    this.changed.emit({ kind: 'SET', photo });
    void this.capture.discardRecovered();
  }
}
