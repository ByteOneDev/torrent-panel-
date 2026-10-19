import {
  BookOpen, Download, Film, Headphones, LayoutDashboard, List, Lock, Play, Shield, Tv, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ServiceIcon as IconName } from '@motflix/shared';

const SERVICE_ICONS: Record<IconName, LucideIcon> = {
  film: Film,
  tv: Tv,
  book: BookOpen,
  headphones: Headphones,
  list: List,
  download: Download,
  shield: Shield,
  play: Play,
  zap: Zap,
  panel: LayoutDashboard,
  lock: Lock,
};

export function ServiceIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Icon = SERVICE_ICONS[name];
  return <Icon className="ic" size={size} strokeWidth={1.8} aria-hidden />;
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
    </svg>
  );
}
