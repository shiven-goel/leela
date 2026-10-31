import { editEvent } from '../lib/actions'
import { useLeela } from '../lib/store'
import { Sheet } from './Sheet'
import { Button } from './ui'

/** Two people edited the same entry at once: let this person choose which version stays. */
export function ConflictDialog() {
  const conflict = useLeela((s) => s.conflict)
  const set = useLeela((s) => s.set)
  const close = () => set({ conflict: null })
  return (
    <Sheet open={Boolean(conflict)} onClose={close} title={`Updated by ${conflict?.byName ?? 'someone'}`}>
      <p className="mb-5 text-[16px] text-ink-2">
        {conflict?.byName ?? 'Someone'} changed this entry while you were editing it. Which version should stay?
      </p>
      <div className="flex flex-col gap-2 pb-2">
        <Button
          onClick={() => {
            if (conflict) void editEvent(conflict.eventId, conflict.patch, { force: true })
            close()
          }}
        >
          Keep my changes
        </Button>
        <Button variant="secondary" onClick={close}>
          Keep {conflict?.byName ?? 'their'}’s version
        </Button>
      </div>
    </Sheet>
  )
}
