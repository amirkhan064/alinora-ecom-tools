import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (options: any) => bootstrapApplication(App, config, options);

export default bootstrap;
