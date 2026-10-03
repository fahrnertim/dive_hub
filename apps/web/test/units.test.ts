// Units and formatting (ADR 0014): what the User reads for a stored value.
import { describe, expect, it } from 'vitest';
import { pickLanguage } from '../src/i18n/languages.ts';
import {
  depthFromDisplay, temperatureFromDisplay,
  formatDepth, formatDiveTime, formatDuration, formatTemperature, pickUnits, unitLabel,
} from '../src/lib/units.ts';

// Intl output uses narrow no-break spaces in places; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('depth', () => {
  it('shows metres with one decimal, in the UI language', () => {
    expect(plain(formatDepth(18.5, 'metric', 'en'))).toBe('18.5 m');
    expect(plain(formatDepth(18.5, 'metric', 'de'))).toBe('18,5 m');
  });

  it('converts to feet for imperial (1 ft = 0.3048 m)', () => {
    expect(plain(formatDepth(30.48, 'imperial', 'en'))).toBe('100 ft');
    expect(plain(formatDepth(18.5, 'imperial', 'en'))).toBe('60.7 ft');
  });

  it('shows a dash when unknown', () => {
    expect(formatDepth(null, 'metric', 'en')).toBe('–');
  });
});

describe('temperature', () => {
  it('rounds to whole degrees and converts to Fahrenheit for imperial', () => {
    expect(plain(formatTemperature(24.4, 'metric', 'en'))).toBe('24°C');
    expect(plain(formatTemperature(25, 'imperial', 'en'))).toBe('77°F');
  });

  it('labels axes with the unit only', () => {
    expect(unitLabel('depth', 'metric', 'en')).toBe('m');
    expect(unitLabel('depth', 'imperial', 'en')).toBe('ft');
    expect(unitLabel('temperature', 'imperial', 'en')).toBe('°F');
    expect(unitLabel('minutes', 'metric', 'de')).toBe('Min.');
  });
});

describe('duration', () => {
  it('shows minutes, and hours plus minutes from one hour on', () => {
    expect(plain(formatDuration(45 * 60 + 20, 'en'))).toBe('45 min');
    expect(plain(formatDuration(65 * 60, 'en'))).toBe('1 hr 5 min');
    expect(plain(formatDuration(65 * 60, 'de'))).toBe('1 Std. 5 Min.');
  });
});

describe('dive time', () => {
  it('shows the local time at the dive site with its UTC offset', () => {
    expect(plain(formatDiveTime('2026-01-15T09:00:00Z', 7200, 'en'))).toBe('Jan 15, 2026, 11:00 AM (UTC+2)');
    expect(plain(formatDiveTime('2026-01-15T09:00:00Z', -9000, 'de'))).toBe('15.01.2026, 06:30 (UTC-2,5)');
  });
});

describe('choosing language and units', () => {
  it('takes the User\'s language, else the first browser language we have, else English', () => {
    expect(pickLanguage('de', ['en-US'])).toBe('de');
    expect(pickLanguage(null, ['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage(null, ['fr-FR'])).toBe('en');
    expect(pickLanguage('pt', [])).toBe('en');
  });

  it('takes the User\'s unit system, else imperial only for regions that use it', () => {
    expect(pickUnits('metric', ['en-US'])).toBe('metric');
    expect(pickUnits(null, ['en-US'])).toBe('imperial');
    expect(pickUnits(null, ['en-GB'])).toBe('metric');
    expect(pickUnits(null, ['de-DE'])).toBe('metric');
    expect(pickUnits(null, [])).toBe('metric');
  });
});

describe('values typed in display units', () => {
  it('are stored back in metres and °C', () => {
    expect(depthFromDisplay(100, 'imperial')).toBeCloseTo(30.48, 6);
    expect(depthFromDisplay(18.5, 'metric')).toBe(18.5);
    expect(temperatureFromDisplay(77, 'imperial')).toBeCloseTo(25, 6);
    expect(temperatureFromDisplay(25, 'metric')).toBe(25);
  });
});
