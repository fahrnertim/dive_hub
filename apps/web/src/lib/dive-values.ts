import { useTranslation } from 'react-i18next';
import type { DiveValues, OverridableField } from '../api.ts';
import { useDisplay } from './display.ts';

/**
 * Fields a Dive's history can name: today's Dive values, and the water type, which was one until it became the
 * Dive site's (ADR 0025). Old Revisions keep mentioning it and stay readable.
 */
export type HistoryField = OverridableField | 'waterType';

const WATER_TYPES = ['fresh', 'salt', 'brackish', 'en13319', 'custom'] as const;

/** Shows one Dive value in the UI language and the User's units, e.g. for history entries and hints. */
export function useFormatValue() {
  const { t } = useTranslation();
  const display = useDisplay();
  return (field: HistoryField, value: unknown): string => {
    if (value === null || value === undefined) return t('common.none');
    switch (field) {
      case 'startsAt': {
        const s = value as DiveValues['startsAt'];
        return display.diveTime(s.at, s.utcOffsetSeconds);
      }
      case 'durationSeconds': return display.duration(value as number);
      case 'maxDepthM': case 'avgDepthM': return display.depth(value as number);
      case 'waterTemperatureC': return display.temperature(value as number);
      case 'waterType': {
        const word = WATER_TYPES.find((w) => w === value);
        return word ? t(`vocabulary.waterType.${word}`) : JSON.stringify(value);
      }
      default: return new Intl.NumberFormat(display.locale).format(value as number);
    }
  };
}
