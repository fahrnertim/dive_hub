import { useId, type ReactNode } from 'react';
import { Dialog, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover } from 'react-aria-components';
import { useNarrow } from '../lib/narrow.ts';
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
  const narrow = useNarrow();
  const triggerId = useId();
  if (actions.length === 0) return null;
  const list = (
    <Menu className="menu" onAction={(key) => actions.find((a) => a.id === key)?.onAction?.()}>
      {actions.map((a) => (
        <MenuItem key={a.id} id={a.id} className="menu-item" textValue={a.label} {...(a.href && { href: a.href })}>
          {a.icon && <Icon name={a.icon} />}{a.label}
        </MenuItem>
      ))}
    </Menu>
  );
  return (
    <MenuTrigger>
      <Button id={triggerId} variant={variant} icon={icon} {...(ariaLabel && { 'aria-label': ariaLabel })} {...(className && { className })}>
        {label}<span className="menu-chevron"><Icon name="open" /></span>
      </Button>
      {/* On a phone the menu is a sheet from the bottom edge, within reach of the thumb; a dialog named by its button. */}
      {narrow
        ? <ModalOverlay isDismissable className="menu-sheet-overlay"><Modal className="menu-sheet"><Dialog className="menu-sheet-dialog" aria-labelledby={triggerId}>{list}</Dialog></Modal></ModalOverlay>
        : <Popover className="popover" placement="bottom end">{list}</Popover>}
    </MenuTrigger>
  );
}
