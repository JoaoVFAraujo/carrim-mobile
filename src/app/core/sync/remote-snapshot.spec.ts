import { RemoteImportConflict } from '../database/remote-import-conflict';
import { snapshotStatements, type RemoteSnapshot } from './remote-snapshot';

describe('remote snapshot contract', () => {
  it('refuses mismatched identities before generating any local writes', () => {
    expect(() =>
      snapshotStatements(
        {
          aggregateType: 'SUPERMARKET',
          aggregateId: 'other',
          snapshot: { id: 'wrong', version: 0 },
        },
        1,
      ),
    ).toThrow(RemoteImportConflict);
  });
  it('keeps products without a barcode in remote metadata without inserting an invalid local catalog row', () => {
    const id = 'a20e47cf-a002-4b01-a001-000000000001';
    const statements = snapshotStatements(
      {
        aggregateType: 'PRODUCT',
        aggregateId: id,
        snapshot: { id, version: 0, barcode: null, name: 'Manual' },
      },
      1,
    );
    expect(statements).toHaveLength(2);
    expect(statements.every((s) => s.statement?.includes('app_metadata'))).toBe(true);
  });
  it('classifies missing and malformed nested remote state as a reconciliation conflict', () => {
    const id = 'a20e47cf-a002-4b01-a001-000000000001';
    for (const snapshot of [
      null,
      {},
      { id, version: 0, name: undefined },
      { id, version: 0, status: 'BROKEN', items: [] },
    ])
      expect(() =>
        snapshotStatements(
          {
            aggregateType: 'SHOPPING_SESSION',
            aggregateId: id,
            snapshot,
          } as unknown as RemoteSnapshot,
          1,
        ),
      ).toThrow(RemoteImportConflict);
  });
});
