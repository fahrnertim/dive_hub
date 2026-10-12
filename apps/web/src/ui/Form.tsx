import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Form as AriaForm, type FormProps } from 'react-aria-components';

/**
 * A form. It opens with the line that says what the mark on a required field means; the line shows only
 * while a field of the form carries the mark (`.form-legend` in ui.css), so a form of optional fields has none.
 */
export function Form({ children, ...props }: FormProps & { ref?: Ref<HTMLFormElement> }) {
  const { t } = useTranslation();
  return (
    <AriaForm {...props}>
      <p className="form-legend" aria-hidden="true">{t('form.requiredLegend')}</p>
      {children}
    </AriaForm>
  );
}
