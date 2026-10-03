import type { Ref } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Icon, type IconName } from './Icon.tsx';

export interface ButtonProps extends Omit<AriaButtonProps, 'className'> {
  /** primary: the one main action of a form or panel; quiet: inline, text-like; danger: destructive. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger' | undefined;
  /** To move focus back to the button, e.g. after a form it opened closes. */
  ref?: Ref<HTMLButtonElement>;
  /** An icon before the label (ADR 0018); the label stays. */
  icon?: IconName | undefined;
}

/**
 * While its action runs, pass `isPending` (not `isDisabled`): the button keeps focus, ignores presses,
 * and screen readers hear that it's busy. A disabled button would drop keyboard focus to the page.
 */
export function Button({ variant = 'secondary', className, icon, children, ...props }: ButtonProps & { className?: string }) {
  return (
    <AriaButton {...props} className={`btn btn-${variant}${className ? ` ${className}` : ''}`}>
      {(state) => (
        <>
          {icon && <Icon name={icon} />}
          {typeof children === 'function' ? children(state) : children}
        </>
      )}
    </AriaButton>
  );
}
