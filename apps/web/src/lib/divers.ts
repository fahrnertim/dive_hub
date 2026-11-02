import { useTranslation } from 'react-i18next';
import type { DiverView } from '../api.ts';

/** A warning when another Diver already has this name (still allowed; UI review C9). */
export function useSameName() {
  const { t } = useTranslation();
  return (divers: DiverView[] | undefined, name: string, except?: string) => {
    const wanted = name.trim().toLocaleLowerCase();
    const twin = wanted && divers?.find((d) => d.id !== except && d.name.toLocaleLowerCase() === wanted);
    return twin ? t('divers.sameName', { name: twin.name }) : undefined;
  };
}
