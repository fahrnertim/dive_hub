// Icons (ADR 0018): Lucide, always next to text and hidden from screen readers. The only file that
// imports lucide-react, so the set stays small and consistent; names here say what the icon means.
// Names were checked with the suggest-lucide-icons skill against the installed version.
import {
  ArrowDown, ArrowRightLeft, ArrowUp, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  CircleCheck, CircleUser, Copy, Ellipsis, ExternalLink, Info, KeyRound, Link, LogOut, MapPin, Pencil, Plus, Scissors, Shield, ShieldOff,
  Star, Trash, Undo2, Upload, User, UserCheck, Users, UserX, type LucideIcon,
} from 'lucide-react';

const ICONS = {
  logbook: BookOpen,
  divers: Users,
  site: MapPin,
  external: ExternalLink,
  admin: Shield,
  account: CircleUser,
  user: User,
  signOut: LogOut,
  back: ChevronLeft,
  previous: ChevronLeft,
  next: ChevronRight,
  open: ChevronDown,
  sortAscending: ArrowUp,
  sortDescending: ArrowDown,
  edit: Pencil,
  more: Ellipsis,
  import: Upload,
  copy: Copy,
  copied: Check,
  save: Check,
  add: Plus,
  link: Link,
  undo: Undo2,
  move: ArrowRightLeft,
  splitOff: Scissors,
  primary: Star,
  delete: Trash,
  resetLink: KeyRound,
  makeAdmin: Shield,
  removeAdmin: ShieldOff,
  disable: UserX,
  enable: UserCheck,
  info: Info,
  success: CircleCheck,
  danger: CircleAlert,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** A decorative icon at the size of the text around it; the text next to it carries the meaning. */
export function Icon({ name }: { name: IconName }) {
  const Glyph = ICONS[name];
  return <Glyph className="icon" aria-hidden="true" focusable="false" strokeWidth={2} />;
}
