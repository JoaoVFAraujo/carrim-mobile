import { InjectionToken, isDevMode } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { configuredApi } from './api-configuration';
export { apiEndpoint } from './api-endpoint-validation';

/** Native/release integration stays disabled until an HTTPS API is configured. */
export const API_BASE_URL = new InjectionToken<string | null>('API_BASE_URL', {
  providedIn: 'root',
  factory: () =>
    configuredApi() ?? (isDevMode() && !Capacitor.isNativePlatform() ? '/api/v1' : null),
});
