/** Empty and zero-result states for the item list. */
import { Plus, SearchX, Vault } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState({
  hasItems,
  isSearching,
  onAdd,
}: {
  hasItems: boolean
  isSearching: boolean
  onAdd?: () => void
}) {
  if (isSearching && hasItems) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <SearchX className="text-muted-foreground size-8" />
        <p className="text-sm font-medium">No matches</p>
        <p className="text-muted-foreground text-sm">
          Nothing in this vault matches that search.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Vault className="text-muted-foreground size-8" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Your vault is empty</p>
        <p className="text-muted-foreground text-sm">
          Add your first login, card, or note to get started.
        </p>
      </div>
      {onAdd ? (
        <Button size="sm" onClick={onAdd}>
          <Plus />
          Add an item
        </Button>
      ) : null}
    </div>
  )
}