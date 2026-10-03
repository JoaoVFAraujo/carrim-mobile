export interface Supermarket {
  id: string;
  name: string;
}

export interface ActiveShoppingSession {
  id: string;
  supermarketId: string;
  supermarketName: string;
  budgetCents: number | null;
  startedAt: number;
}

export function parseBudget(value: string): number | null {
  const input = value.trim();
  if (!input) return null;
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(input)) throw new Error('Informe um limite como 200,00.');
  const [whole, fraction = ''] = input.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) {
    throw new Error('Informe um limite entre R$ 0,01 e R$ 1.000.000,00.');
  }
  return cents;
}
