import { snapshotStatements } from './remote-snapshot';

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
    ).toThrow('inválido');
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
});
