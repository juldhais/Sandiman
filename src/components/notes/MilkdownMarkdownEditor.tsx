import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/classic.css'
import { useEffect, useRef, useState } from 'react'
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { Textarea } from '@/components/ui/textarea'

/** Milkdown Crepe editor whose Markdown source remains the persisted note value. */
export function MilkdownMarkdownEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (markdown: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const initialValue = useRef(value)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = root.current
    if (!element) return

    let disposed = false
    let created = false
    const editor = new CrepeBuilder({ root: element, defaultValue: initialValue.current })
      // Build only the note-authoring features used here. The high-level Crepe
      // preset also pulls a full code-language catalog and optional math/image
      // tooling into the static application bundle.
      .addFeature(cursor)
      .addFeature(linkTooltip)
      .addFeature(listItem)
      .addFeature(placeholder, { text: 'Start writing…', mode: 'doc' })
      .addFeature(table)
      .addFeature(toolbar)
      .on((listener) => {
        listener.markdownUpdated((_context, markdown) => onChange(markdown))
      })

    void editor.create().then(() => {
      created = true
      if (disposed) void editor.destroy()
    }).catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      if (created) void editor.destroy()
    }
  }, [onChange])

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Rich editor unavailable; Markdown source is shown instead.</p>
        <Textarea
          aria-label="Note in Markdown"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={20}
          className="min-h-[55dvh] resize-y font-mono text-base"
          spellCheck
        />
      </div>
    )
  }

  return (
    <div className="note-markdown-editor min-h-[55dvh]">
      <div ref={root} className="milkdown" />
    </div>
  )
}
