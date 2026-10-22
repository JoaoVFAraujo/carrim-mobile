import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { PhotoEditorComponent } from './photo-editor.component';
import { ProductPhotoService } from '../../../core/photos/product-photo.service';
import { PhotoCaptureService } from '../../../features/photos/services/photo-capture.service';

describe('photo editor target removal', () => {
  async function setup() {
    const get = vi.fn().mockResolvedValue({
      source: 'USER',
      status: 'APPROVED',
      imageUrl: 'data:image/jpeg;base64,/9j/2Q==',
    });
    const hidden = vi.fn().mockResolvedValue(false);
    await TestBed.configureTestingModule({
      imports: [PhotoEditorComponent],
      providers: [
        { provide: ProductPhotoService, useValue: { get, hidden, revision: signal(0) } },
        { provide: PhotoCaptureService, useValue: { native: false, recovered: signal(null) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PhotoEditorComponent);
    return { fixture, get, hidden };
  }

  it('clears the previous photo and hidden flag when a catalog item becomes manual', async () => {
    const { fixture } = await setup();
    fixture.componentRef.setInput('barcode', '7898080643179');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.preview()).toContain('data:image/jpeg');
    fixture.componentInstance.storedHidden.set(true);
    fixture.componentRef.setInput('barcode', null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.existing()).toBeNull();
    expect(fixture.componentInstance.storedHidden()).toBe(false);
    expect(fixture.componentInstance.preview()).toBeNull();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });

  it('does not restore an old photo when its pending lookup completes after the target is cleared', async () => {
    const { fixture, get } = await setup();
    let resolve!: (value: unknown) => void;
    get.mockImplementation(() => new Promise((done) => (resolve = done)));
    fixture.componentRef.setInput('barcode', '7898080643179');
    fixture.detectChanges();
    TestBed.tick();
    expect(get).toHaveBeenCalled();
    fixture.componentRef.setInput('barcode', null);
    fixture.detectChanges();
    TestBed.tick();
    resolve({ source: 'USER', imageUrl: 'data:image/jpeg;base64,/9j/2Q==' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.existing()).toBeNull();
    expect(fixture.componentInstance.preview()).toBeNull();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });
});
