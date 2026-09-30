import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('initializes the Ionic application shell', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: appConfig.providers,
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('ion-app')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ion-router-outlet')).not.toBeNull();
  });
});
