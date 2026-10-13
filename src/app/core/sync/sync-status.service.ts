import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly message = signal('');
}
