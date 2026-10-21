import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ProductPhotoComponent } from './product-photo.component';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';

describe('product photo selection and removal', () => {
  async function setup(hidden = false) {
    const get = vi.fn().mockResolvedValue(null),
      revision = signal(0);
    await TestBed.configureTestingModule({
      imports: [ProductPhotoComponent],
      providers: [
        {
          provide: ProductPhotoService,
          useValue: {
            get,
            hidden: vi.fn().mockResolvedValue(hidden),
            refresh: vi.fn().mockResolvedValue(undefined),
            revision,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductPhotoComponent);
    fixture.componentRef.setInput('barcode', '7898080643179');
    fixture.componentRef.setInput(
      'fallbackUrl',
      'https://images.openfoodfacts.org/images/products/789/front.jpg',
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, get, revision };
  }
  it('does not resurrect the external suggestion when the user hid the image', async () => {
    const { fixture, revision } = await setup(true);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    revision.update((n) => n + 1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
  it('shows a local photo in preference to the external fallback', async () => {
    const { fixture, get, revision } = await setup();
    get.mockResolvedValue({ imageUrl: 'data:image/jpeg;base64,/9j/2Q==' });
    revision.update((n) => n + 1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toContain(
      'data:image/jpeg',
    );
  });
  it('previews removal immediately before the existing stored preference is saved', async () => {
    const { fixture } = await setup();
    fixture.componentRef.setInput('overrideActive', true);
    fixture.componentRef.setInput('overrideUrl', null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
});
