import { parseItemPrice, parseItemQuantity } from './shopping-item';

describe('manual shopping item', () => {
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
