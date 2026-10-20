import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly message = signal('');
  readonly activityRevision = signal(0);
  readonly lastSyncedAt = signal<number | null>(null);
}
