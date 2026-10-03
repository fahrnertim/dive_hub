import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, meQuery } from '../api.ts';
import {
  formatDateTime, formatDepth, formatDiveTime, formatDuration, formatTemperature, pickUnits, unitLabel,
} from './units.ts';

/** Formatting in the UI language and the User's unit system (ADR 0014). */
export function useDisplay() {
  const { i18n } = useTranslation();
  const me = useQuery(meQuery());
  const units = pickUnits(me.data?.preferences.units, navigator.languages);
  const locale = i18n.language;
  return {
    locale,
    units,
    depth: (metres: number | null) => formatDepth(metres, units, locale),
    temperature: (celsius: number | null) => formatTemperature(celsius, units, locale),
    duration: (seconds: number) => formatDuration(seconds, locale),
    diveTime: (iso: string, offsetSeconds: number | null) => formatDiveTime(iso, offsetSeconds, locale),
    dateTime: (iso: string) => formatDateTime(iso, locale),
    unit: (quantity: 'depth' | 'temperature') => unitLabel(quantity, units, locale),
  };
}

/** A message for the person in front of the screen, translated from the server's error code. */
export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    if (error instanceof ApiError && error.code) return t(`errors.${error.code}`, { defaultValue: error.message });
    return t('errors.unknown');
  };
}
