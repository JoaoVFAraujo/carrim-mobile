import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '../database/database.service';
import { snapshotStatements, RemoteSnapshot } from './remote-snapshot';
import { SyncRequest, SyncTransportService } from './sync-transport.service';
import { SyncStatusService } from './sync-status.service';

interface ReviewEntry {
  id: string;
  status: string;
  last_error: string;
  request_json: string;
  aggregate_type: string;
  aggregate_id: string;
}
interface ReviewCheck {
  statement: string;
  values: (string | number | null)[];
  expected: Record<string, unknown>[];
}
export interface SyncReview {
  local: string[];
  remote: string[];
  allowed: boolean;
  reason: string;
}
interface SavedDecision {
  createdAt: number;
  local: string[];
  remote: string[];
}

const money = (value: unknown) =>
  typeof value === 'number'
    ? (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'Sem limite';
function describe(value: Record<string, unknown>): string[] {
  const result: string[] = [];
  if (typeof value['name'] === 'string') result.push(value['name']);
  if (typeof value['productNameSnapshot'] === 'string') result.push(value['productNameSnapshot']);
  if ('barcode' in value) result.push('Código: ' + (value['barcode'] ?? 'não informado'));
  if ('measurementType' in value)
    result.push('Medida: ' + (value['measurementType'] === 'WEIGHT' ? 'peso' : 'unidade'));
  if ('budgetCents' in value) result.push('Limite: ' + money(value['budgetCents']));
  if (typeof value['status'] === 'string')
    result.push(
      'Compra: ' +
        ({ ACTIVE: 'em andamento', COMPLETED: 'finalizada', CANCELED: 'cancelada' }[
          String(value['status'])
        ] ?? 'estado não reconhecido'),
    );
  const price = value['unitPriceCents'] ?? value['pricePerKgCents'] ?? value['bundlePriceCents'];
  if (typeof price === 'number') result.push('Preço: ' + money(price));
  if (typeof value['quantityUnits'] === 'number')
    result.push('Quantidade: ' + value['quantityUnits']);
  if (typeof value['weightGrams'] === 'number') result.push('Peso: ' + value['weightGrams'] + ' g');
  if (typeof value['bundleQuantity'] === 'number')
    result.push('Grupo promocional: ' + value['bundleQuantity']);
  return result;
}

@Injectable({ providedIn: 'root' })
export class SyncReviewService {
  private readonly db = inject(DatabaseService);
  private readonly transport = inject(SyncTransportService);
  private readonly status = inject(SyncStatusService);
  readonly view = signal<SyncReview | null>(null);
  readonly archives = signal<SavedDecision[]>([]);
  private pending?: {
    entry: ReviewEntry;
    request: SyncRequest;
    remote: RemoteSnapshot;
    checks: ReviewCheck[];
    view: SyncReview;
  };

  async load(): Promise<void> {
    this.pending = undefined;
    this.view.set(null);
    const history = await this.db.query<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key LIKE 'sync_review:%' ORDER BY key DESC LIMIT 20",
    );
    this.archives.set(history.map((row) => JSON.parse(row.value) as SavedDecision));
    const checks: ReviewCheck[] = [];
    const capture = async (statement: string, values: (string | number | null)[] = []) => {
      const expected = await this.db.query<Record<string, unknown>>(statement, values);
      checks.push({ statement, values, expected });
      return expected;
    };
    const queue = await capture(
      "SELECT * FROM sync_queue WHERE status!='SYNCED' ORDER BY sequence_number",
    );
    const entry = queue[0] as unknown as ReviewEntry | undefined;
    if (
      !entry ||
      entry.status !== 'FAILED' ||
      entry.last_error !== 'CONFLICT' ||
      !entry.request_json
    ) {
      this.view.set({
        local: [],
        remote: [],
        allowed: false,
        reason:
          'Não há um conflito de envio que possa ser revisado agora. As compras locais foram preservadas.',
      });
      return;
    }
    const owner = await capture(
      "SELECT key,value FROM app_metadata WHERE key IN ('sync_owner','sync_pull_paused') ORDER BY key",
    );
    if (owner.some((row) => row['key'] === 'sync_pull_paused' && row['value'] === '1'))
      throw new Error('O recebimento precisa ser analisado antes de reenviar alterações.');
    const request = JSON.parse(entry.request_json) as SyncRequest;
    if (
      request.operationId !== entry.id ||
      request.aggregateId !== entry.aggregate_id ||
      request.aggregateType !== entry.aggregate_type
    )
      throw new Error('Não foi possível confirmar a alteração salva.');
    const item = request.aggregateType === 'SHOPPING_ITEM';
    const type = item ? 'SHOPPING_SESSION' : request.aggregateType;
    if (type !== 'SHOPPING_SESSION' && type !== 'PRODUCT' && type !== 'SUPERMARKET')
      throw new Error('Alteração não reconhecida.');
    const id = item
      ? String((request.payload as Record<string, unknown>)['sessionId'])
      : request.aggregateId;
    const table = {
      SHOPPING_SESSION: 'shopping_sessions',
      PRODUCT: 'products',
      SUPERMARKET: 'supermarkets',
    }[type];
    const rows = await capture(`SELECT * FROM ${table} WHERE id=?`, [id]);
    if (!rows.length) throw new Error('O registro local não está disponível.');
    if (type === 'SHOPPING_SESSION') {
      await capture('SELECT * FROM shopping_items WHERE session_id=? ORDER BY id', [id]);
      await capture('SELECT * FROM price_history WHERE session_id=? ORDER BY id', [id]);
    }
    const remote = await this.transport.current(type, id);
    snapshotStatements(remote, Date.now()); // Validate untrusted fresh HTTP snapshot before offering any decision.
    const payload = request.payload as Record<string, unknown>;
    const localValues = item ? (payload['item'] as Record<string, unknown> | undefined) : payload;
    const remoteItems = remote.snapshot['items'] as Record<string, unknown>[] | undefined;
    const remoteItem = remoteItems?.find((value) => value['id'] === request.aggregateId);
    const exists = item ? Boolean(remoteItem) : true;
    const active =
      type !== 'SHOPPING_SESSION' ||
      (remote.snapshot['status'] === 'ACTIVE' && rows[0]['status'] === 'ACTIVE');
    const supported = item
      ? ['CREATE', 'UPDATE', 'DELETE'].includes(request.operation) &&
        (request.operation === 'CREATE' ? !exists : exists)
      : request.operation === 'UPDATE';
    const view: SyncReview = {
      local:
        request.operation === 'DELETE'
          ? ['Remover este produto da compra']
          : describe(localValues ?? {}),
      remote: describe(
        item ? (remoteItem ?? { name: 'Produto ainda não está nesta compra' }) : remote.snapshot,
      ),
      allowed: active && supported,
      reason:
        active && supported
          ? 'Você pode reaplicar somente esta alteração. Uma cópia da revisão será guardada neste aparelho. Se o servidor mudar novamente, a sincronização pausará outra vez.'
          : 'Este caso envolve criação, encerramento ou dados que exigem análise adicional. A sincronização continuará pausada para proteger suas compras.',
    };
    this.pending = { entry, request, remote, checks, view };
    this.view.set(view);
  }

  async confirm(): Promise<void> {
    const review = this.pending;
    if (!review?.view.allowed) throw new Error('Abra um conflito válido antes de confirmar.');
    const newId = crypto.randomUUID(),
      now = Date.now();
    // This is a new, explicitly authorized command. Never mutate/retry an old idempotent request.
    const replacement = {
      ...review.request,
      operationId: newId,
      baseVersion: review.remote.snapshot.version,
    };
    await this.db.checkedTransaction(
      review.checks,
      [
        {
          statement: 'INSERT INTO app_metadata(key,value) VALUES (?,?)',
          values: [
            `sync_review:${now}:${newId}`,
            JSON.stringify({
              createdAt: now,
              local: review.view.local,
              remote: review.view.remote,
              original: review.entry,
              observations: review.checks,
              server: review.remote,
              replacement,
            }),
          ],
        },
        {
          statement: `UPDATE sync_queue SET id=?,status='PENDING',attempt_count=0,next_attempt_at_ms=NULL,processing_started_at_ms=NULL,lease_token=NULL,last_error=NULL,request_json=?,updated_at_ms=? WHERE id=? AND status='FAILED' AND last_error='CONFLICT'`,
          values: [newId, JSON.stringify(replacement), now, review.entry.id],
        },
      ],
      true,
    ); // Wake the worker only after the approved replacement is committed.
    this.pending = undefined;
    this.view.set(null);
    this.status.message.set(
      'Sua decisão foi salva. A alteração será sincronizada quando houver conexão.',
    );
  }
}
