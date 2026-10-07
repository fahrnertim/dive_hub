import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, meQuery, type ProblemCode } from '../api.ts';
import { countryName, formatDistance, formatPosition, type Position } from './geo.ts';
import {
  formatDate, formatDateTime, formatDepth, formatDiveTime, formatDuration, formatTemperature, pickUnits, unitLabel,
} from './units.ts';

/** Formatting in the UI language and the User's unit system (ADR 0014). */
export function useDisplay() {
  const { i18n, t } = useTranslation();
  const me = useQuery(meQuery());
  const units = pickUnits(me.data?.preferences.units, navigator.languages);
  const locale = i18n.language;
  return {
    locale,
    units,
    depth: (metres: number | null) => formatDepth(metres, units, locale),
    temperature: (celsius: number | null) => formatTemperature(celsius, units, locale),
    duration: (seconds: number) => formatDuration(seconds, locale),
    /** `source` unknown: the time as it was logged, without a time zone (ADR 0030). */
    diveTime: (iso: string, offsetSeconds: number | null, source?: string) => formatDiveTime(iso, offsetSeconds, locale, source === 'unknown'),
    dateTime: (iso: string) => formatDateTime(iso, locale),
    date: (iso: string) => formatDate(iso, locale),
    /** "28.4950° N, 34.5160° E" (ADR 0020). */
    position: (p: Position) => formatPosition(p, locale, {
      north: t('geo.north'), south: t('geo.south'), east: t('geo.east'), west: t('geo.west'),
    }),
    distance: (metres: number) => formatDistance(metres, units, locale),
    country: (code: string) => countryName(code, locale),
    unit: (quantity: 'depth' | 'temperature' | 'minutes') => unitLabel(quantity, units, locale),
  };
}

/**
 * The text of a problem code. A provider_* code names its Provider (ADR 0027): the Provider's own wording where it has
 * one (SSI: "e-mail and password"), else the generic text with its name.
 */
export function useProblemText() {
  const { t, i18n } = useTranslation();
  return (code: ProblemCode, provider?: { id: string; name: string }, fallback?: string): string => {
    const own = provider && `providers.${provider.id}.errors.${code}`;
    const key = own && i18n.exists(own) ? own : `errors.${code}`;
    return t(key as `errors.${ProblemCode}`, { name: provider?.name ?? t('provider.someService'), ...(fallback && { defaultValue: fallback }) });
  };
}

/** A message for the person in front of the screen, translated from the server's error code. */
export function useErrorText() {
  const { t } = useTranslation();
  const problemText = useProblemText();
  return (error: unknown): string => {
    if (error instanceof ApiError && error.code) return problemText(error.code, error.provider, error.message);
    return t('errors.unknown');
  };
}
