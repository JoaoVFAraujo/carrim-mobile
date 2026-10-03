import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type {
  SQLiteConnection,
  SQLiteDBConnection,
  capSQLiteSet,
} from '@capacitor-community/sqlite';
import { initialSchema } from './migrations/001-initial-schema';

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private connection?: SQLiteConnection;
  private database?: SQLiteDBConnection;
  private opening?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  async query<T>(statement: string, values: (string | number | null)[] = []): Promise<T[]> {
    return this.serial(async () => {
      await this.open();
      const result = await this.database!.query(statement, values);
      return (result.values ?? []) as T[];
    });
  }

  async transaction(statements: capSQLiteSet[]): Promise<void> {
    return this.serial(async () => {
      await this.open();
      await this.database!.executeSet(statements, true);
      if (!Capacitor.isNativePlatform()) await this.connection!.saveToStore('carrim');
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async open(): Promise<void> {
    if (!this.opening) {
      this.opening = this.initialize().catch(async (error: unknown) => {
        this.opening = undefined;
        await this.connection?.closeConnection('carrim', false).catch(() => undefined);
        this.database = undefined;
        throw error;
      });
    }
    return this.opening;
  }

  private async initialize(): Promise<void> {
    const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
    this.connection = new SQLiteConnection(CapacitorSQLite);
    if (!Capacitor.isNativePlatform()) {
      const { defineCustomElements } = await import('jeep-sqlite/loader');
      await defineCustomElements(window);
      if (!document.querySelector('jeep-sqlite')) {
        const element = document.createElement('jeep-sqlite');
        element.setAttribute('wasm-path', '/assets');
        document.body.appendChild(element);
      }
      await customElements.whenDefined('jeep-sqlite');
      await this.connection.initWebStore();
    }
    this.database = await this.connection.createConnection(
      'carrim',
      false,
      'no-encryption',
      1,
      false,
    );
    await this.database.open();
    await this.database.execute('PRAGMA foreign_keys = ON;', false);
    const tables = await this.database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    );
    if (!tables.values?.length) {
      await this.database.executeSet(
        initialSchema.map((statement) => ({ statement, values: [] })),
        true,
      );
    }
    const versions = await this.database.query(
      'SELECT MAX(version) AS version FROM schema_migrations',
    );
    if (versions.values?.[0]?.version !== 1) throw new Error('Versão do banco não suportada.');
    await this.database.run('INSERT OR IGNORE INTO app_metadata(key, value) VALUES (?, ?)', [
      'installation_id',
      crypto.randomUUID(),
    ]);
    if (!Capacitor.isNativePlatform()) await this.connection.saveToStore('carrim');
  }
}
