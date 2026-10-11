/**
 * Dynamic lucide icon lookup.
 *
 * Templates store an icon *name* rather than a component reference, because the
 * whole template list is encrypted as JSON. Names are resolved to components at
 * render time, with a safe fallback so a template referencing an icon that a
 * future lucide version dropped still renders.
 */
import {
  Banknote,
  Bookmark,
  Box,
  Building2,
  CalendarClock,
  CircleUser,
  Cloud,
  Code,
  CreditCard,
  Database,
  FileText,
  Fingerprint,
  Globe,
  IdCard,
  KeyRound,
  KeySquare,
  Landmark,
  Lock,
  Mail,
  MapPin,
  Package,
  Phone,
  Shield,
  Smartphone,
  StickyNote,
  Square,
  Star,
  Terminal,
  User,
  Users,
  Wallet,
  Wifi,
  type LucideIcon,
} from 'lucide-react'

const REGISTRY: Record<string, LucideIcon> = {
  Banknote,
  Bookmark,
  Box,
  Building2,
  CalendarClock,
  CircleUser,
  Cloud,
  Code,
  CreditCard,
  Database,
  FileText,
  Fingerprint,
  Globe,
  IdCard,
  KeyRound,
  KeySquare,
  Landmark,
  Lock,
  Mail,
  MapPin,
  Package,
  Phone,
  Shield,
  Smartphone,
  StickyNote,
  Square,
  Star,
  Terminal,
  User,
  Users,
  Wallet,
  Wifi,
}

/** Icon names offered in the template builder's picker. */
export const ICON_CHOICES = Object.keys(REGISTRY).sort()

export function resolveIcon(name: string): LucideIcon {
  return REGISTRY[name] ?? Square
}