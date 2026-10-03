export interface ShoppingItem {
  id: string;
  sessionId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}

export function parseItemPrice(value: string): number {
  const input = value.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(input)) throw new Error('Informe um preço como 12,99.');
  const [whole, fraction = ''] = input.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) {
    throw new Error('Informe um preço entre R$ 0,01 e R$ 1.000.000,00.');
  }
  return cents;
}

export function parseItemQuantity(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error('Informe uma quantidade inteira.');
  const quantity = Number(value);
  if (quantity < 1 || quantity > 9999) throw new Error('Informe uma quantidade entre 1 e 9999.');
  return quantity;
}
