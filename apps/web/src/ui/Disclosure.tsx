import type { ReactNode } from 'react';
import { Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { Icon } from './Icon.tsx';

/**
 * One line that opens what is behind it. The title is the button, with an arrow as the cue that there is more
 * (better-layout: hidden content needs one); `summary` is what stays in sight beside it while closed. The whole line
 * can be pressed. With `level` the title is a heading. `isExpanded` and `onExpandedChange` when the page decides
 * what is open; else it starts closed, or open with `defaultExpanded`.
 */
export function Disclosure({ title, summary, level, isExpanded, defaultExpanded, onExpandedChange, className, children }: {
  title: ReactNode; summary?: ReactNode; level?: 2 | 3; isExpanded?: boolean | undefined; defaultExpanded?: boolean;
  onExpandedChange?: (open: boolean) => void; className?: string; children: ReactNode;
}) {
  const trigger = <AriaButton slot="trigger" className="disclosure-trigger"><Icon name="next" />{title}</AriaButton>;
  return (
    <AriaDisclosure
      className={className ? `disclosure ${className}` : 'disclosure'}
      {...(isExpanded !== undefined && { isExpanded })} {...(defaultExpanded && { defaultExpanded })} {...(onExpandedChange && { onExpandedChange })}
    >
      <div className="disclosure-head">
        {level ? <Heading level={level} className="disclosure-title">{trigger}</Heading> : trigger}
        {summary}
      </div>
      <DisclosurePanel className="disclosure-panel">{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
