import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
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
import { PHOTO_ADMIN_STANDALONE } from './photo-admin-mode';

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
  readonly standalonePanel = inject(PHOTO_ADMIN_STANDALONE);
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
    this.selectedIds.set(new Set());
    this.batchAction.set(null);
    const request = ++this.request;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      let rows = await this.service.list(this.status, this.offset);
      while (request === this.request && rows.length === 0 && this.offset > 0) {
        this.offset = Math.max(0, this.offset - 20);
        rows = await this.service.list(this.status, this.offset);
      }
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
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly batchAction = signal<'APPROVE' | 'REJECT' | null>(null);
  readonly batchProgress = signal('');
  readonly selectable = computed(() =>
    this.rows().filter((row) => row.status === 'PENDING' && row.imageUrl),
  );

  toggleSelection(id: string): void {
    if (this.busy() || this.batchAction() || !this.selectable().some((row) => row.id === id))
      return;
    const ids = new Set(this.selectedIds());
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    this.selectedIds.set(ids);
  }

  selectPage(): void {
    if (this.busy() || this.batchAction()) return;
    const ids = this.selectable().map((row) => row.id);
    this.selectedIds.set(new Set(this.selectedIds().size === ids.length ? [] : ids));
  }

  async confirmBatch(): Promise<void> {
    const action = this.batchAction();
    if (!action || this.busy()) return;
    const selected = this.selectable().filter((row) => this.selectedIds().has(row.id));
    this.batchAction.set(null);
    if (!selected.length) return;

    const request = ++this.request;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    let done = 0;
    let failure = '';
    for (const row of selected) {
      this.batchProgress.set(`Revisando ${done + 1} de ${selected.length}…`);
      try {
        await this.service.decide(row, action, row.reason ?? '');
      } catch (error) {
        failure = (error as Error).message;
        break;
      }
      if (request !== this.request) return;
      done++;
    }
    if (request !== this.request) return;
    this.batchProgress.set('');
    this.busy.set(false);
    await this.load();
    if (request + 1 !== this.request) return;
    this.notice.set(`Concluídas: ${done} de ${selected.length}.`);
    if (failure)
      this.error.set(
        `O lote foi interrompido. ${failure} Confira a fila antes de tentar novamente.`,
      );
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
    this.selectedIds.set(new Set());
    this.batchAction.set(null);
    this.batchProgress.set('');
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
