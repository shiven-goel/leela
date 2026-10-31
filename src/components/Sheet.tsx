import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { X } from '@phosphor-icons/react'

/** Lets the phone's back button close the top sheet instead of leaving the app. */
function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const marker = { leelaSheet: Math.random() }
    window.history.pushState(marker, '')
    let poppedByUs = false
    const onPop = () => {
      poppedByUs = true
      closeRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (!poppedByUs && window.history.state === marker) window.history.back()
    }
  }, [open])
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  tone,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  tone?: string
}) {
  const reduce = useReducedMotion()
  const titleId = useId()
  const drag = useDragControls()
  useBackToClose(open, onClose)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--scrim)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[92dvh] w-full max-w-[560px] flex-col rounded-t-[28px] bg-card shadow-lift"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 380 }}
            drag={reduce ? false : 'y'}
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) onClose()
            }}
          >
            <div
              className="flex cursor-grab touch-none justify-center pt-2.5 pb-1"
              aria-hidden="true"
              onPointerDown={(e) => drag.start(e)}
            >
              <span className="h-1.5 w-10 rounded-full bg-line" />
            </div>
            <header className="flex touch-none items-center gap-3 px-5 pb-3" onPointerDown={(e) => drag.start(e)}>
              {tone && <span className="h-6 w-1.5 rounded-full" style={{ background: `var(--${tone})` }} aria-hidden="true" />}
              <h2 id={titleId} className="font-display text-[22px] font-bold leading-tight">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-card-2 text-ink-2"
                aria-label="Close"
              >
                <X size={20} weight="bold" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
              {children}
            </div>
            {footer && <footer className="safe-bottom border-t border-line px-5 pt-3">{footer}</footer>}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  )
}
