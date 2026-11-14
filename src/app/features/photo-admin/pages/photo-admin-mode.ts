import { InjectionToken } from '@angular/core';

export const PHOTO_ADMIN_STANDALONE = new InjectionToken<boolean>('PHOTO_ADMIN_STANDALONE', {
  providedIn: 'root',
  factory: () => false,
});
