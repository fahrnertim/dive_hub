import type { ReactNode } from 'react';
import { ToggleButton, type ToggleButtonProps } from 'react-aria-components';
import { Icon } from './Icon.tsx';

/**
 * A quick filter that is on or off ("No recording 14"): pressed, it is also the display of the applied filter. The
 * state is `aria-pressed`, a check mark and the weight, never the colour alone. `count`: how many items it would show.
 */
export function ToggleChip({ children, count, ...props }: Omit<ToggleButtonProps, 'className' | 'children'> & { children: ReactNode; count?: number }) {
  return (
    <ToggleButton {...props} className="chip">
      {({ isSelected }) => (
        <>
          {isSelected && <Icon name="pressed" />}
          <span>{children}</span>
          {count !== undefined && <span className="chip-count">{count}</span>}
        </>
      )}
    </ToggleButton>
  );
}
