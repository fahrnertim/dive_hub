import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FieldError, Input, Label, Text, TextField as AriaTextField, ToggleButton, type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';
import { Icon } from './Icon.tsx';

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'className' | 'children'> {
  label: ReactNode;
  description?: ReactNode;
  placeholder?: string;
}

/** The error under a field, in our translations, not in the browser's language. */
function useMessage(props: Pick<AriaTextFieldProps, 'type' | 'minLength' | 'maxLength'>) {
  const { t } = useTranslation();
  return ({ validationDetails: v, validationErrors }: ValidationResult) => {
    if (v.valueMissing) return t('form.required');
    if (v.typeMismatch && props.type === 'email') return t('form.invalidEmail');
    if (v.tooShort && props.minLength) return t('form.tooShort', { count: props.minLength });
    if (v.tooLong && props.maxLength) return t('form.tooLong', { count: props.maxLength });
    return validationErrors.join(' ');
  };
}

function FieldLabel({ label, isRequired }: { label: ReactNode; isRequired: boolean | undefined }) {
  return <Label className="field-label">{label}{isRequired && <span className="field-required" aria-hidden="true"> *</span>}</Label>;
}

/**
 * A labelled input with its description and error, validated natively on submit. The messages come
 * from our translations, not from the browser's language.
 */
export function TextField({ label, description, placeholder, ...props }: TextFieldProps) {
  const message = useMessage(props);
  return (
    <AriaTextField {...props} className="field">
      <FieldLabel label={label} isRequired={props.isRequired} />
      <Input className="input" {...(placeholder !== undefined && { placeholder })} />
      {/* A description that may appear while typing is passed as '' at first: React Aria links the
          description element when the field mounts. */}
      {description !== undefined && <Text slot="description" className="field-description">{description}</Text>}
      <FieldError className="field-error">{message}</FieldError>
    </AriaTextField>
  );
}

export interface PasswordFieldProps extends Omit<TextFieldProps, 'type' | 'label'> {
  /** Text, as it also names the button: "Show: <label>" (no two buttons on a page share a name). */
  label: string;
  /** What the button names instead of the label, where two fields of one label share a page (a dialog over a form). */
  buttonItem?: string | undefined;
}

/**
 * A password or secret, hidden, with a button inside the field that shows it (backlog 0016). The input stays the
 * same element with its name and autocomplete, so password managers keep filling it; only its type switches.
 * The button keeps its name and says whether the password shows with aria-pressed. Sending the form hides it again.
 */
export function PasswordField({ label, buttonItem, description, placeholder, ...props }: PasswordFieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const message = useMessage({ ...props, type: 'password' });
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return undefined;
    const hide = () => setShown(false);
    form.addEventListener('submit', hide);
    form.addEventListener('reset', hide);
    return () => {
      form.removeEventListener('submit', hide);
      form.removeEventListener('reset', hide);
    };
  }, []);
  return (
    <AriaTextField {...props} type={shown ? 'text' : 'password'} className="field">
      <FieldLabel label={label} isRequired={props.isRequired} />
      <div className="input-with-button">
        {/* Shown as text, the browser must not spellcheck, capitalise or correct it (some spellcheckers send text away). */}
        <Input ref={input} className="input" spellCheck="false" autoCapitalize="none" autoCorrect="off" {...(placeholder !== undefined && { placeholder })} />
        <ToggleButton
          className="input-button" isSelected={shown} onChange={setShown} isDisabled={props.isDisabled ?? false}
          aria-label={t('common.forItem', { action: t('form.show'), item: buttonItem ?? label })}
        >
          <Icon name={shown ? 'hide' : 'show'} />
        </ToggleButton>
      </div>
      {description !== undefined && <Text slot="description" className="field-description">{description}</Text>}
      <FieldError className="field-error">{message}</FieldError>
    </AriaTextField>
  );
}
