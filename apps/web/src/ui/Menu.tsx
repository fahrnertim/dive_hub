import type { ReactNode } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Button } from './Button.tsx';

export interface MenuAction {
  id: string;
  label: string;
  /** Runs the action; or `href` navigates. */
  onAction?: () => void;
  href?: string;
}

/**
 * Secondary actions behind one button (UI review C3, C4), so a panel shows its main action and
 * stays calm. `label` is the visible text; `aria-label` (optional) says whose actions they are and
 * starts with the visible text (WCAG 2.5.3).
 */
export function ActionMenu({ label, 'aria-label': ariaLabel, actions, variant = 'quiet', className }: {
  label: ReactNode; 'aria-label'?: string; actions: MenuAction[]; variant?: 'quiet' | 'secondary'; className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <MenuTrigger>
      <Button variant={variant} {...(ariaLabel && { 'aria-label': ariaLabel })} {...(className && { className })}>
        {label}<span aria-hidden="true" className="menu-chevron">▾</span>
      </Button>
      <Popover className="popover" placement="bottom end">
        <Menu className="menu" onAction={(key) => actions.find((a) => a.id === key)?.onAction?.()}>
          {actions.map((a) => (
            <MenuItem key={a.id} id={a.id} className="menu-item" {...(a.href && { href: a.href })}>{a.label}</MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
