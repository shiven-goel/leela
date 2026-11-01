import clsx from 'clsx'
import { BookOpenText, ClockCounterClockwise, House, NotePencil, UsersThree } from '@phosphor-icons/react'
import { type Tab, useLeela } from '../lib/store'

const TABS: { id: Tab; label: string; Icon: typeof House }[] = [
  { id: 'today', label: 'Today', Icon: House },
  { id: 'history', label: 'History', Icon: ClockCounterClockwise },
  { id: 'notes', label: 'Notes', Icon: NotePencil },
  { id: 'diary', label: 'Diary', Icon: BookOpenText },
  { id: 'family', label: 'Family', Icon: UsersThree },
]

export function TabBar() {
  const tab = useLeela((s) => s.tab)
  const set = useLeela((s) => s.set)
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur" aria-label="Main">
      <ul className="mx-auto grid max-w-[560px] grid-cols-5">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  set({ tab: id })
                  window.scrollTo({ top: 0 })
                }}
                aria-current={on ? 'page' : undefined}
                className={clsx('flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[12px] font-semibold', on ? 'text-brand' : 'text-ink-3')}
              >
                <Icon size={26} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
