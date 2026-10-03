import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FieldError, Input, Label, Text, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'className' | 'children'> {
  label: ReactNode;
  description?: ReactNode;
  placeholder?: string;
}

/**
 * A labelled input with its description and error, validated natively on submit. The messages come
 * from our translations, not from the browser's language.
 */
export function TextField({ label, description, placeholder, ...props }: TextFieldProps) {
  const { t } = useTranslation();
  const message = ({ validationDetails: v, validationErrors }: ValidationResult) => {
    if (v.valueMissing) return t('form.required');
    if (v.typeMismatch && props.type === 'email') return t('form.invalidEmail');
    if (v.tooShort && props.minLength) return t('form.tooShort', { count: props.minLength });
    if (v.tooLong && props.maxLength) return t('form.tooLong', { count: props.maxLength });
    return validationErrors.join(' ');
  };
  return (
    <AriaTextField {...props} className="field">
      <Label className="field-label">{label}</Label>
      <Input className="input" {...(placeholder !== undefined && { placeholder })} />
      {/* A description that may appear while typing is passed as '' at first: React Aria links the
          description element when the field mounts. */}
      {description !== undefined && <Text slot="description" className="field-description">{description}</Text>}
      <FieldError className="field-error">{message}</FieldError>
    </AriaTextField>
  );
}
