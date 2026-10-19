import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly message = signal('');
  readonly lastSyncedAt = signal<number | null>(null);
}
