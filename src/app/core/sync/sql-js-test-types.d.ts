declare module 'sql.js' {
  interface Statement {
    bind(values: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  interface Database {
    run(sql: string, values?: unknown[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }
  export default function initSqlJs(): Promise<{ Database: new (data?: Uint8Array) => Database }>;
}
declare module 'node:process' {
  export const env: Record<string, string | undefined>;
}
