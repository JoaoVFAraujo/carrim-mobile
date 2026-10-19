/** Unwrap only a valid BRL display; keep malformed values for domain validation. */
export function moneyInput(value: string): string {
  const input = value.trim();
  if (!input.startsWith('R$')) return input;
  const amount = input.slice(2).trim();
  if (!amount) return '';
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(amount)) return input;
  return amount.replaceAll('.', '');
}
