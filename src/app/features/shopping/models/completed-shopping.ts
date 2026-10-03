export interface CompletedShopping {
  id: string;
  supermarketName: string;
  budgetCents: number | null;
  finishedAt: number;
  totalCents: number;
  itemCount: number;
}
