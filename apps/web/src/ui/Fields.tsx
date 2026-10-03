import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon.tsx';
import {
  Button as AriaButton, DateField as AriaDateField, DateInput, DateSegment, FieldError, Group, Input, Label, ListBox,
  ListBoxItem, NumberField as AriaNumberField, Popover, Select as AriaSelect, SelectValue, Text, TextArea as AriaTextArea,
  TextField as AriaTextField, type DateFieldProps, type DateValue, type NumberFieldProps as AriaNumberFieldProps,
  type ValidationResult,
} from 'react-aria-components';

function useMessage() {
  const { t } = useTranslation();
  return ({ validationDetails: v, validationErrors }: ValidationResult) =>
    v.valueMissing ? t('form.required') : validationErrors.join(' ');
}

interface FieldChrome {
  label: ReactNode;
  description?: ReactNode;
}

/**
 * A number in the UI language's format ("18,5" in German), with optional unit after it.
 * Arrow keys step the value; the stepper buttons are left out to keep forms calm.
 */
export function NumberField({ label, description, unit, onInput, ...props }: FieldChrome & Omit<AriaNumberFieldProps, 'className' | 'children'> & {
  unit?: string;
  /** While typing; onChange only fires when the value commits (blur, Enter). */
  onInput?: () => void;
}) {
  const message = useMessage();
  return (
    <AriaNumberField {...props} className="field">
      {/* The unit is part of the field's name for screen readers ("Max depth (m)"); visually it follows the input. */}
      <Label className="field-label">{label}{unit && <span className="visually-hidden"> ({unit})</span>}</Label>
      <Group className="input-group">
        <Input className="input" onInput={onInput} />
        {unit && <span className="input-unit" aria-hidden="true">{unit}</span>}
      </Group>
      {description && <Text slot="description" className="field-description">{description}</Text>}
      <FieldError className="field-error">{message}</FieldError>
    </AriaNumberField>
  );
}

/** Multi-line text, e.g. notes. */
export function TextArea({ label, description, ...props }: FieldChrome & {
  name?: string; value?: string; onChange?: (value: string) => void; maxLength?: number;
}) {
  return (
    <AriaTextField {...props} className="field">
      <Label className="field-label">{label}</Label>
      <AriaTextArea className="input textarea" rows={4} />
      {description && <Text slot="description" className="field-description">{description}</Text>}
    </AriaTextField>
  );
}

/** One choice from a short list. `null` in options is the "none" entry. */
export function Select<K extends string>({ label, description, options, value, onChange, size }: FieldChrome & {
  options: { id: K; label: ReactNode }[];
  value: K | null;
  onChange: (value: K | null) => void;
  /** small: inside a table row (a Device's owner). */
  size?: 'small';
}) {
  return (
    <AriaSelect
      className={size ? `field select-${size}` : 'field'}
      selectedKey={value}
      onSelectionChange={(key) => onChange((key as K) ?? null)}
    >
      <Label className="field-label">{label}</Label>
      <AriaButton className="input select-button">
        <SelectValue className="select-value" />
        <span className="select-chevron"><Icon name="open" /></span>
      </AriaButton>
      {description && <Text slot="description" className="field-description">{description}</Text>}
      <Popover className="popover">
        <ListBox className="listbox">
          {options.map((o) => <ListBoxItem key={o.id} id={o.id} className="listbox-item">{o.label}</ListBoxItem>)}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

/** Date and time typed segment by segment, in the UI language's order (day.month.year in German). */
export function DateTimeField<T extends DateValue>({ label, description, ...props }: FieldChrome & Omit<DateFieldProps<T>, 'className' | 'children'>) {
  const message = useMessage();
  return (
    <AriaDateField {...props} className="field" granularity="minute">
      <Label className="field-label">{label}</Label>
      <DateInput className="input date-input">
        {(segment) => <DateSegment segment={segment} className="date-segment" />}
      </DateInput>
      {description && <Text slot="description" className="field-description">{description}</Text>}
      <FieldError className="field-error">{message}</FieldError>
    </AriaDateField>
  );
}
