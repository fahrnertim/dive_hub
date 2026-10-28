import type { ReactNode } from 'react';
import {
  Checkbox as AriaCheckbox, Label, Radio, RadioGroup as AriaRadioGroup, Switch as AriaSwitch,
  type CheckboxProps as AriaCheckboxProps, type RadioGroupProps as AriaRadioGroupProps, type SwitchProps as AriaSwitchProps,
} from 'react-aria-components';

export function Checkbox({ children, ...props }: Omit<AriaCheckboxProps, 'className' | 'children'> & { children: ReactNode }) {
  return (
    <AriaCheckbox {...props} className="checkbox">
      <span className="checkbox-box" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
      {children}
    </AriaCheckbox>
  );
}

/** A setting that takes effect the moment it is switched (role switch); a choice made with a button to save is a Checkbox. */
export function Switch({ children, ...props }: Omit<AriaSwitchProps, 'className' | 'children'> & { children: ReactNode }) {
  return (
    <AriaSwitch {...props} className="switch">
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      {children}
    </AriaSwitch>
  );
}

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, 'className' | 'children'> {
  label: ReactNode;
  options: { value: string; label: ReactNode }[];
}

export function RadioGroup({ label, options, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup {...props} className="radio-group">
      <Label className="field-label">{label}</Label>
      {options.map((o) => (
        <Radio key={o.value} value={o.value} className="radio">
          <span className="radio-dot" aria-hidden="true" />
          {o.label}
        </Radio>
      ))}
    </AriaRadioGroup>
  );
}
