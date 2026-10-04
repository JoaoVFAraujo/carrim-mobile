import { CompletedShopping } from '../../shopping/models/completed-shopping';

export type HistoryPeriod = 'all' | 'month';

export function groupHistory(history: CompletedShopping[], period: HistoryPeriod, now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const sorted = history
    .filter(
      (shopping) => period === 'all' || (shopping.finishedAt >= start && shopping.finishedAt < end),
    )
    .sort((a, b) => b.finishedAt - a.finishedAt || b.id.localeCompare(a.id));
  const groups = new Map<string, { key: string; date: Date; purchases: CompletedShopping[] }>();
  for (const shopping of sorted) {
    const date = new Date(shopping.finishedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        date: new Date(date.getFullYear(), date.getMonth(), 1),
        purchases: [],
      });
    groups.get(key)!.purchases.push(shopping);
  }
  return [...groups.values()];
}
