/**
 * Icon wrapper for template-driven rows.
 *
 * Templates store an icon name, so the component is resolved at render time
 * through the registry, which falls back to a neutral square for unknown names.
 */
import { resolveIcon } from '@/components/icon-registry'

export function TemplateIcon({
  icon,
  className,
}: {
  icon: string
  className?: string
}) {
  const Icon = resolveIcon(icon)
  return <Icon className={className} aria-hidden />
}