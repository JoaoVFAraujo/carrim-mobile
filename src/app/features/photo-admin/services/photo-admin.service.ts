import { HttpBackend, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, apiEndpoint } from '../../../core/api/api-endpoint';

export interface ReviewPhoto {
  id: string;
  barcode: string | null;
  itemId: string | null;
  name: string;
  source: string;
  status: string;
  version: number;
  imageUrl?: string;
  reason?: string;
}

/** Administrative credential stays in memory and is never attached to business requests. */
@Injectable({ providedIn: 'root' })
export class PhotoAdminService {
  private readonly base = inject(API_BASE_URL);
  private readonly http = new HttpClient(inject(HttpBackend));
  private key = '';
  login(key: string): void {
    if (!/^[A-Za-z0-9_-]{43}$/.test(key))
      throw new Error('Informe a chave de administração válida.');
    this.key = key;
  }
  logout(): void {
    this.key = '';
  }
  private options() {
    if (!this.key) throw new Error('Entre na administração para continuar.');
    return {
      headers: { 'X-Carrim-Photo-Admin': this.key },
      credentials: 'omit' as const,
      redirect: 'error' as const,
      cache: 'no-store' as const,
      timeout: 15000,
    };
  }
  async list(status: string, offset: number): Promise<ReviewPhoto[]> {
    if (
      !['PENDING', 'APPROVED', 'REJECTED'].includes(status) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new Error('Filtro inválido.');
    try {
      const values = await firstValueFrom(
        this.http.get<ReviewPhoto[]>(apiEndpoint(this.base, '/photo-admin/photos'), {
          ...this.options(),
          params: { status, limit: 20, offset },
        }),
      );
      if (
        !Array.isArray(values) ||
        values.length > 20 ||
        values.some(
          (p) =>
            !p ||
            !this.uuid(p.id) ||
            typeof p.name !== 'string' ||
            p.name.length > 120 ||
            !Number.isSafeInteger(p.version) ||
            p.version < 0,
        )
      )
        throw new Error('Invalid response');
      return values;
    } catch (error) {
      throw this.failure(error);
    }
  }
  async image(id: string): Promise<Blob> {
    if (!this.uuid(id)) throw new Error('Foto inválida.');
    try {
      const blob = await firstValueFrom(
        this.http.get(apiEndpoint(this.base, '/photo-admin/photos/' + id + '/content'), {
          ...this.options(),
          responseType: 'blob',
        }),
      );
      if (blob.type !== 'image/jpeg' || blob.size > 512000) throw new Error('Invalid image');
      return blob;
    } catch (error) {
      throw this.failure(error);
    }
  }
  async decide(photo: ReviewPhoto, decision: 'APPROVE' | 'REJECT', reason: string): Promise<void> {
    if (!this.uuid(photo.id) || reason.length > 200) throw new Error('Dados da revisão inválidos.');
    try {
      await firstValueFrom(
        this.http.post(
          apiEndpoint(this.base, '/photo-admin/photos/' + photo.id + '/decision'),
          { decision, version: photo.version, reason: reason.trim() || null },
          this.options(),
        ),
      );
    } catch (error) {
      throw this.failure(error);
    }
  }
  private uuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }
  private failure(error: unknown): Error {
    if (error instanceof HttpErrorResponse && [401, 403].includes(error.status)) {
      this.logout();
      return new Error('Acesso não autorizado. Confira a chave e a configuração do servidor.');
    }
    if (error instanceof HttpErrorResponse && error.status === 409)
      return new Error('A foto mudou durante a revisão. Atualize a lista antes de decidir.');
    return new Error('Não foi possível concluir a revisão. Tente novamente.');
  }
}
