import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AlertController } from '@ionic/angular';
import { SyncReviewService } from '../../../core/sync/sync-review.service';
import { SyncReviewComponent } from './sync-review.component';

describe('conflict confirmation', () => {
  it('keeps the pending operation untouched when confirmation is dismissed', async () => {
    const confirm = vi.fn();
    const alert = { present: vi.fn(), onDidDismiss: vi.fn().mockResolvedValue({ role: 'cancel' }) };
    TestBed.configureTestingModule({
      providers: [
        SyncReviewComponent,
        { provide: SyncReviewService, useValue: { view: signal({ allowed: true }), confirm } },
        { provide: AlertController, useValue: { create: async () => alert } },
      ],
    });
    const component = TestBed.inject(SyncReviewComponent);
    await component.confirm();
    expect(confirm).not.toHaveBeenCalled();
    expect(component.busy()).toBe(false);
  });
});
