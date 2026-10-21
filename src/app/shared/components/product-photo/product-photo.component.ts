import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { cubeOutline } from 'ionicons/icons';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';

@Component({
  selector: 'app-product-photo',
  imports: [IonIcon],
  templateUrl: './product-photo.component.html',
  styleUrl: './product-photo.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductPhotoComponent {
  readonly barcode = input<string | null>(null);
  readonly itemId = input<string | null>(null);
  readonly name = input('Produto');
  readonly fallbackUrl = input<string | null>(null);
  readonly overrideActive = input(false);
  readonly overrideUrl = input<string | null>(null);
  readonly icon = input(cubeOutline);
  readonly image = signal<string | null>(null);
  readonly failed = signal(false);
  private readonly photos = inject(ProductPhotoService);
  private request = 0;

  constructor() {
    effect(() => {
      const target = {
        barcode: this.barcode(),
        itemId: this.barcode() ? null : this.itemId(),
        name: this.name(),
      };
      if (target.barcode || target.itemId) void this.photos.refresh(target).catch(() => undefined);
    });
    effect(() => {
      this.photos.revision();
      const target = { barcode: this.barcode(), itemId: this.barcode() ? null : this.itemId() };
      const fallback = this.fallbackUrl();
      const request = ++this.request;
      this.failed.set(false);
      if (this.overrideActive()) {
        this.image.set(this.overrideUrl());
        return;
      }
      if (!target.barcode && !target.itemId) {
        this.image.set(fallback);
        return;
      }
      void Promise.all([this.photos.get(target), this.photos.hidden(target)])
        .then(([photo, hidden]) => {
          if (request === this.request)
            this.image.set(hidden ? null : (photo?.imageUrl ?? fallback));
        })
        .catch(() => {
          if (request === this.request) this.image.set(null);
        });
    });
  }
}
