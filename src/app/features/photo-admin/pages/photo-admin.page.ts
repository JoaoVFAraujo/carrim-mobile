import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { PhotoAdminService, type ReviewPhoto } from '../services/photo-admin.service';

@Component({
  selector: 'app-photo-admin',
  imports: [
    FormsModule,
    RouterLink,
    IonButton,
    IonContent,
    IonHeader,
    IonInput,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
  templateUrl: './photo-admin.page.html',
  styleUrl: './photo-admin.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoAdminPage {
  private readonly service = inject(PhotoAdminService);
  readonly signedIn = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly rows = signal<ReviewPhoto[]>([]);
  readonly preview = signal<ReviewPhoto | null>(null);
  key = '';
  status = 'PENDING';
  offset = 0;
  private request = 0;
  constructor() {
    inject(DestroyRef).onDestroy(() => this.logout());
  }
  async login(): Promise<void> {
    if (this.busy()) return;
    try {
      this.service.login(this.key.trim());
      this.key = '';
      await this.load();
      if (!this.error()) this.signedIn.set(true);
    } catch (error) {
      this.key = '';
      this.error.set((error as Error).message);
    }
  }
  async load(): Promise<void> {
    if (this.busy()) return;
    const request = ++this.request;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const rows = await this.service.list(this.status, this.offset);
      if (request !== this.request) return;
      this.releaseImages();
      this.rows.set(rows);
      for (let index = 0; index < rows.length; index += 3) {
        await Promise.all(
          rows.slice(index, index + 3).map(async (row) => {
            try {
              const blob = await this.service.image(row.id);
              if (request !== this.request) return;
              const imageUrl = URL.createObjectURL(blob);
              this.rows.update((current) =>
                current.map((item) => (item.id === row.id ? { ...item, imageUrl } : item)),
              );
            } catch {
              /* A missing preview must not expose unverified content. */
            }
          }),
        );
      }
    } catch (error) {
      if (request === this.request) this.error.set((error as Error).message);
    } finally {
      if (request === this.request) this.busy.set(false);
    }
  }
  async filter(): Promise<void> {
    this.offset = 0;
    await this.load();
  }
  async page(delta: number): Promise<void> {
    this.offset = Math.max(0, this.offset + delta * 20);
    await this.load();
  }
  async decide(row: ReviewPhoto, decision: 'APPROVE' | 'REJECT'): Promise<void> {
    if (this.busy() || !row.imageUrl) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.service.decide(row, decision, row.reason ?? '');
      this.busy.set(false);
      await this.load();
      this.notice.set(
        decision === 'APPROVE'
          ? 'Foto aprovada para o catálogo.'
          : 'Foto rejeitada para publicação.',
      );
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
  logout(): void {
    ++this.request;
    this.service.logout();
    this.key = '';
    this.preview.set(null);
    this.releaseImages();
    this.rows.set([]);
    this.signedIn.set(false);
    this.busy.set(false);
  }
  ionViewWillLeave(): void {
    this.logout();
  }
  private releaseImages(): void {
    this.rows().forEach((row) => {
      if (row.imageUrl) URL.revokeObjectURL(row.imageUrl);
    });
  }
}
