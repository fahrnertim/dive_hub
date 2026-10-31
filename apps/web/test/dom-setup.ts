// Set-up of the component tests (*.test.tsx, in jsdom): the texts in English, as main.tsx starts them, and an empty
// document after each test.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initI18n } from '../src/i18n/index.ts';

initI18n(['en']);

afterEach(() => { cleanup(); });
