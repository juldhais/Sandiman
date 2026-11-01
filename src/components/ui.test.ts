import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/vault/EmptyState'
import { ExpiryBadge } from '@/components/ExpiryBadge'
import { CopyButton } from '@/components/CopyButton'
import type { ExpiryEntry } from '@/storage/expiry'

describe('UI Components Render Testing', () => {
  describe('EmptyState Component', () => {
    it('renders empty vault message when not searching', () => {
      const markup = renderToStaticMarkup(
        createElement(EmptyState, {
          hasItems: false,
          isSearching: false,
        }),
      )

      expect(markup).toContain('Your vault is empty')
      expect(markup).toContain('Add your first login, card, or note to get started.')
    })

    it('renders no matches message when searching and vault has items', () => {
      const markup = renderToStaticMarkup(
        createElement(EmptyState, {
          hasItems: true,
          isSearching: true,
        }),
      )

      expect(markup).toContain('No matches')
      expect(markup).toContain('Nothing in this vault matches that search.')
    })

    it('renders Add an item button when onAdd handler is provided', () => {
      const markup = renderToStaticMarkup(
        createElement(EmptyState, {
          hasItems: false,
          isSearching: false,
          onAdd: () => {},
        }),
      )

      expect(markup).toContain('Add an item')
    })
  })

  describe('ExpiryBadge Component', () => {
    it('renders expired badge with destructive styling and icon', () => {
      const entry: ExpiryEntry = {
        itemId: 'item-1',
        itemTitle: 'Personal Visa',
        fieldId: 'card_exp',
        fieldLabel: 'Card Expiry',
        raw: '01/20',
        expiresAt: new Date('2020-01-31T23:59:59.999Z'),
        daysRemaining: -100,
        status: 'expired',
      }

      const markup = renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(ExpiryBadge, {
            entry,
            showLabel: true,
          }),
        ),
      )

      expect(markup).toContain('Card Expiry')
      expect(markup).toContain('Expired')
    })

    it('renders valid/ok badge', () => {
      const entry: ExpiryEntry = {
        itemId: 'item-2',
        itemTitle: 'Work Pass',
        fieldId: 'exp_date',
        fieldLabel: 'Valid Until',
        raw: '31/12/2099',
        expiresAt: new Date('2099-12-31T23:59:59.999Z'),
        daysRemaining: 1000,
        status: 'ok',
      }

      const markup = renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(ExpiryBadge, {
            entry,
            showLabel: false,
          }),
        ),
      )

      // 1000 days formats to 3y in compact badge representation
      expect(markup).toContain('3y')
    })
  })

  describe('CopyButton Component', () => {
    it('renders copy button with correct accessibility label', () => {
      const markup = renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(CopyButton, {
            value: 'test-user@example.com',
            label: 'Username',
          }),
        ),
      )

      expect(markup).toContain('aria-label="Copy Username"')
      expect(markup).not.toContain('disabled=""')
    })

    it('disables copy button when value is empty', () => {
      const markup = renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(CopyButton, {
            value: '',
            label: 'Empty Field',
          }),
        ),
      )

      expect(markup).toContain('disabled=""')
    })
  })
})
