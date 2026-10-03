export interface ShoppingItem {
  id: string;
  sessionId: string;
  name: string;
  /** Price per unit for UNIT; price per kg for WEIGHT. */
  unitPriceCents: number;
  quantity: number;
  barcode?: string | null;
  measurementType?: 'UNIT' | 'WEIGHT';
  weightGrams?: number | null;
}

export function itemSubtotalCents(item: ShoppingItem): number {
  // For WEIGHT the pricing unit is one kg; quantity is always 1.
  return item.measurementType === 'WEIGHT'
    ? Math.floor((item.unitPriceCents * item.weightGrams! + 500) / 1000)
    : item.unitPriceCents * item.quantity;
}

export function parseWeightGrams(value: string): number {
  const input = value.trim();
  if (!/^\d+(?:[,.]\d{1,3})?$/.test(input))
    throw new Error('Informe o peso em kg com até três casas decimais, como 0,824.');
  const [whole, fraction = ''] = input.replace(',', '.').split('.');
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(grams) || grams < 1 || grams > 9999999)
    throw new Error('Informe um peso entre 0,001 e 9999,999 kg.');
  return grams;
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
