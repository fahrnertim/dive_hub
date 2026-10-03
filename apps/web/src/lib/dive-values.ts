import { useTranslation } from 'react-i18next';
import type { DiveValues, OverridableField } from '../api.ts';
import { useDisplay } from './display.ts';

/** Shows one Dive value in the UI language and the User's units, e.g. for history entries and hints. */
export function useFormatValue() {
  const { t } = useTranslation();
  const display = useDisplay();
  return <F extends OverridableField>(field: F, value: DiveValues[F] | null | undefined): string => {
    if (value === null || value === undefined) return t('common.none');
    switch (field) {
      case 'startsAt': {
        const s = value as DiveValues['startsAt'];
        return display.diveTime(s.at, s.utcOffsetSeconds);
      }
      case 'durationSeconds': return display.duration(value as number);
      case 'maxDepthM': case 'avgDepthM': return display.depth(value as number);
      case 'waterTemperatureC': return display.temperature(value as number);
      case 'waterType': return t(`vocabulary.waterType.${value as NonNullable<DiveValues['waterType']>}`);
      default: return new Intl.NumberFormat(display.locale).format(value as number);
    }
  };
}
