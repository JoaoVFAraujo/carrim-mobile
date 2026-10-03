export interface CatalogProduct {
  id: string;
  barcode: string;
  name: string;
}

export interface LastProductPrice {
  unitPriceCents: number;
  recordedAt: number;
}

// Codes stay as text, including any leading zero. Camera formats are restricted to retail codes.
export function parseBarcode(value: string): string {
  const code = value.trim();
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) {
    throw new Error('Informe um código de barras com 8, 12 ou 13 dígitos.');
  }
  return code;
}
