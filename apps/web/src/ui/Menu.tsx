import type { ReactNode } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Button } from './Button.tsx';
import { Icon, type IconName } from './Icon.tsx';

export interface MenuAction {
  id: string;
  label: string;
  icon?: IconName;
  /** Runs the action; or `href` navigates. */
  onAction?: () => void;
  href?: string;
}

/**
 * Secondary actions behind one button (UI review C3, C4), so a panel shows its main action and
 * stays calm. `label` is the visible text; `aria-label` (optional) says whose actions they are and
 * starts with the visible text (WCAG 2.5.3).
 */
export function ActionMenu({ label, 'aria-label': ariaLabel, actions, variant = 'quiet', className, icon }: {
  label: ReactNode; 'aria-label'?: string; actions: MenuAction[]; variant?: 'quiet' | 'secondary'; className?: string; icon?: IconName;
}) {
  if (actions.length === 0) return null;
  return (
    <MenuTrigger>
      <Button variant={variant} icon={icon} {...(ariaLabel && { 'aria-label': ariaLabel })} {...(className && { className })}>
        {label}<span className="menu-chevron"><Icon name="open" /></span>
      </Button>
      <Popover className="popover" placement="bottom end">
        <Menu className="menu" onAction={(key) => actions.find((a) => a.id === key)?.onAction?.()}>
          {actions.map((a) => (
            <MenuItem key={a.id} id={a.id} className="menu-item" textValue={a.label} {...(a.href && { href: a.href })}>
              {a.icon && <Icon name={a.icon} />}{a.label}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
