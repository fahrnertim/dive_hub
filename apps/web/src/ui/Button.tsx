import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

export interface ButtonProps extends Omit<AriaButtonProps, 'className'> {
  /** primary: the one main action of a form or panel; quiet: inline, text-like; danger: destructive. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}

/**
 * While its action runs, pass `isPending` (not `isDisabled`): the button keeps focus, ignores presses,
 * and screen readers hear that it's busy. A disabled button would drop keyboard focus to the page.
 */
export function Button({ variant = 'secondary', ...props }: ButtonProps) {
  return <AriaButton {...props} className={`btn btn-${variant}`} />;
}
