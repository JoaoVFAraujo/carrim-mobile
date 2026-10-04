import { groupHistory } from './history-groups';
import { CompletedShopping } from '../../shopping/models/completed-shopping';

const purchase = (id: string, finishedAt: number): CompletedShopping => ({
  id,
  finishedAt,
  supermarketName: 'Mercado',
  budgetCents: null,
  checkoutTotalCents: null,
  totalCents: 100,
  itemCount: 1,
});

describe('history month groups', () => {
  it('uses local month boundaries including year changes', () => {
    const history = [
      purchase('before', new Date(2025, 11, 31, 23, 59).getTime()),
      purchase('start', new Date(2026, 0, 1).getTime()),
      purchase('end', new Date(2026, 0, 31, 23, 59).getTime()),
      purchase('after', new Date(2026, 1, 1).getTime()),
    ];
    expect(
      groupHistory(history, 'month', new Date(2026, 0, 15))[0].purchases.map((p) => p.id),
    ).toEqual(['end', 'start']);
  });
  it('orders groups and purchases newest first without mutating the source', () => {
    const history = [
      purchase('old', new Date(2026, 8, 1).getTime()),
      purchase('new', new Date(2026, 9, 1).getTime()),
    ];
    const groups = groupHistory(history, 'all', new Date(2026, 9, 2));
    expect(groups.map((g) => g.purchases[0].id)).toEqual(['new', 'old']);
    expect(history[0].id).toBe('old');
    expect(groupHistory(history, 'month', new Date(2027, 0, 1))).toEqual([]);
  });
});
