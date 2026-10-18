import { DOCUMENT, registerLocaleData } from '@angular/common';
import pt from '@angular/common/locales/pt';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HistoryPage } from './history.page';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';

describe('history resume', () => {
  it('distinguishes an unreported checkout from zero and opens read-only items from the summary', async () => {
    registerLocaleData(pt);
    const finishedAt = new Date(2026, 9, 17).getTime();
    const purchases = [
      {
        id: 'missing',
        supermarketName: 'Mercado A',
        finishedAt,
        totalCents: 100,
        checkoutTotalCents: null,
        itemCount: 1,
        budgetCents: null,
      },
      {
        id: 'zero',
        supermarketName: 'Mercado B',
        finishedAt,
        totalCents: 100,
        checkoutTotalCents: 0,
        itemCount: 1,
        budgetCents: null,
      },
    ];
    const completedItems = vi.fn().mockResolvedValue([]);
    await TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [
        provideRouter([]),
        provideIonicAngular(),
        {
          provide: ShoppingSessionStore,
          useValue: {
            history: signal(purchases),
            loading: signal(false),
            error: signal(''),
            completedItems,
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    const records: NodeListOf<HTMLDetailsElement> =
      fixture.nativeElement.querySelectorAll('.purchase-record');
    const missing = [...records].find((record) => record.textContent!.includes('Mercado A'))!;
    const zero = [...records].find((record) => record.textContent!.includes('Mercado B'))!;
    expect(missing.textContent).toContain('Não informado');
    expect(missing.textContent).not.toContain('Diferença');
    expect(zero.textContent).not.toContain('Não informado');
    expect(zero.textContent).toContain('Diferença');
    expect(zero.textContent).toMatch(/-R\$\s*1,00/);
    missing.querySelector<HTMLElement>('summary')!.click();
    expect(missing.open).toBe(true);
    missing.querySelector<HTMLElement>('.view-items')!.click();
    await fixture.whenStable();
    expect(completedItems).toHaveBeenCalledWith('missing');
    expect(fixture.componentInstance.selected()?.id).toBe('missing');
    fixture.componentInstance.close();
    fixture.detectChanges();
    fixture.destroy();
  });

  it('refreshes this month when returning from the background across a month boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 0, 31, 23, 59));
      const document = { visibilityState: 'hidden' };
      TestBed.configureTestingModule({
        providers: [
          HistoryPage,
          { provide: DOCUMENT, useValue: document },
          {
            provide: ShoppingSessionStore,
            useValue: {
              history: signal([
                { id: 'jan', finishedAt: new Date(2026, 0, 1).getTime() },
                { id: 'feb', finishedAt: new Date(2026, 1, 1).getTime() },
              ]),
            },
          },
        ],
      });
      const page = TestBed.inject(HistoryPage);
      page.period.set('month');
      expect(page.groups()[0].purchases[0].id).toBe('jan');
      vi.setSystemTime(new Date(2026, 1, 1));
      page.refreshDate();
      expect(page.groups()[0].purchases[0].id).toBe('jan');
      document.visibilityState = 'visible';
      page.refreshDate();
      expect(page.groups()[0].purchases[0].id).toBe('feb');
    } finally {
      vi.useRealTimers();
    }
  });
});
