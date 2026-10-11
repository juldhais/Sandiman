/**
 * Light/dark toggle.
 *
 * `resolved` is passed in rather than read from the hook here so the same
 * button can be rendered from several screens without each re-subscribing.
 */
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/state/useTheme'
import { Button } from '@/components/ui/button'

export function ToggleThemeButton({ resolved }: { resolved?: 'light' | 'dark' }) {
  const { resolved: active, setTheme } = useTheme()
  const current = resolved ?? active

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(current === 'dark' ? 'light' : 'dark')}
      aria-label={current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {current === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}