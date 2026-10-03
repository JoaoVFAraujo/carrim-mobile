import {
  parseItemPrice,
  parseItemQuantity,
  parseWeightGrams,
  itemSubtotalCents,
} from './shopping-item';

describe('manual shopping item', () => {
  it('converts kilograms to integer grams without floating point multiplication', () => {
    expect(parseWeightGrams('0,824')).toBe(824);
    expect(parseWeightGrams('1.5')).toBe(1500);
    expect(parseWeightGrams('0,001')).toBe(1);
    expect(parseWeightGrams('9999,999')).toBe(9999999);
    for (const input of ['', '0', '-1', '0,0001', 'NaN', '10000', '1,2345'])
      expect(() => parseWeightGrams(input)).toThrow();
  });
  it('rounds each weighted subtotal half up to cents', () => {
    const item = {
      id: 'i',
      sessionId: 's',
      name: 'Banana',
      unitPriceCents: 699,
      quantity: 1,
      measurementType: 'WEIGHT' as const,
      weightGrams: 824,
    };
    expect(itemSubtotalCents(item)).toBe(576);
    expect(itemSubtotalCents({ ...item, unitPriceCents: 1, weightGrams: 499 })).toBe(0);
    expect(itemSubtotalCents({ ...item, unitPriceCents: 1, weightGrams: 500 })).toBe(1);
    expect(itemSubtotalCents({ ...item, unitPriceCents: 100000000, weightGrams: 9999999 })).toBe(
      999999900000,
    );
    expect(
      itemSubtotalCents({ ...item, measurementType: 'UNIT', quantity: 2, weightGrams: null }),
    ).toBe(1398);
  });
  it('parses BRL prices into exact cents', () => {
    expect(parseItemPrice('12,99')).toBe(1299);
    expect(parseItemPrice('0.01')).toBe(1);
    expect(parseItemPrice('19,9')).toBe(1990);
    for (const input of ['', '0', '-1', '1,999', 'NaN'])
      expect(() => parseItemPrice(input)).toThrow();
  });
  it('accepts only positive whole quantities within the supported range', () => {
    expect(parseItemQuantity('2')).toBe(2);
    for (const input of ['', '0', '-1', '1.5', '10000'])
      expect(() => parseItemQuantity(input)).toThrow();
  });
});
