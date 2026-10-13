import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadApiConfiguration } from './app/core/api/api-configuration';

loadApiConfiguration()
  .then(() => bootstrapApplication(App, appConfig))
  .catch(() => console.error('Não foi possível iniciar o aplicativo.'));
