import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PasswordInput } from '@/components/PasswordInput'

describe('PasswordInput controlled reveal state', () => {
  it('can show generated passwords by default', () => {
    const markup = renderToStaticMarkup(
      createElement(PasswordInput, {
        value: 'generated-secret',
        readOnly: true,
        defaultRevealed: true,
      }),
    )

    expect(markup).toContain('type="text"')
  })

  it('renders the value as text when the parent reveals it', () => {
    const markup = renderToStaticMarkup(
      createElement(PasswordInput, {
        value: 'secret',
        readOnly: true,
        revealable: false,
        revealed: true,
      }),
    )

    expect(markup).toContain('type="text"')
  })
})
