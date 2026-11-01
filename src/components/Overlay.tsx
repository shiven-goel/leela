import { ArrowLeft } from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useId } from 'react'
import { useBackToClose } from './Sheet'

/** A full screen that slides over the app, for longer jobs like importing or writing a note. */
export function Overlay({
  open,
  onClose,
  onBack,
  title,
  children,
  footer,
  actions,
}: {
  open: boolean
  onClose: () => void
  /** A step back inside the screen; return true to stay open. */
  onBack?: () => boolean
  title: string
  children: ReactNode
  footer?: ReactNode
  actions?: ReactNode
}) {
  const reduce = useReducedMotion()
  const titleId = useId()
  const back = () => {
    if (onBack?.()) return true
    onClose()
  }
  useBackToClose(open, back)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-40 flex flex-col bg-bg"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: 'easeOut' }}
        >
          <header className="safe-top shrink-0 border-b border-line bg-bg/95 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-[640px] items-center gap-2 px-3">
              <button type="button" onClick={() => void back()} className="grid h-11 w-11 place-items-center rounded-full" aria-label="Back">
                <ArrowLeft size={24} weight="bold" />
              </button>
              <h1 id={titleId} className="min-w-0 flex-1 truncate font-display text-[20px] font-bold">
                {title}
              </h1>
              {actions}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-[640px] px-5 pt-5 pb-10">{children}</div>
          </div>
          {footer && (
            <div className="safe-bottom shrink-0 border-t border-line bg-card/95 backdrop-blur">
              <div className="mx-auto max-w-[640px] px-5 py-3">{footer}</div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
