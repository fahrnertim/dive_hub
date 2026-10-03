import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

export interface ButtonProps extends Omit<AriaButtonProps, 'className'> {
  /** primary: the one main action of a form or panel; quiet: inline, text-like; danger: destructive. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}

export function Button({ variant = 'secondary', ...props }: ButtonProps) {
  return <AriaButton {...props} className={`btn btn-${variant}`} />;
}
