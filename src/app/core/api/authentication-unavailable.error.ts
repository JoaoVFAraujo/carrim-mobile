import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

/** Retry information only: no response body, URL, credential or original cause. */
export class AuthenticationUnavailableError extends Error {
  constructor(readonly status: number) {
    super('Não foi possível conectar com segurança. Tente novamente.');
  }
}

export function authenticationUnavailable(error: unknown): AuthenticationUnavailableError | null {
  const status =
    error instanceof TimeoutError
      ? 408
      : error instanceof HttpErrorResponse || error instanceof AuthenticationUnavailableError
        ? error.status
        : null;
  return status === 0 ||
    status === 408 ||
    status === 429 ||
    (status !== null && status >= 500 && status <= 599)
    ? new AuthenticationUnavailableError(status)
    : null;
}
