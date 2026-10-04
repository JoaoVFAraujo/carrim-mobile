import { DOCUMENT } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HistoryPage } from './history.page';
import { ShoppingSessionStore } from '../../shopping/services/shopping-session.store';

describe('history resume', () => {
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
