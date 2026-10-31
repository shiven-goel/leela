import { AnimatePresence, motion } from 'motion/react'
import { useLeela } from '../lib/store'

export function Toasts() {
  const toasts = useLeela((s) => s.toasts)
  const dismiss = useLeela((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[92px] z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-2xl px-4 py-3 text-[15px] shadow-lift"
            style={{ background: t.tone === 'error' ? 'var(--health)' : 'var(--ink)', color: t.tone === 'error' ? '#fff' : 'var(--bg)' }}
            role="status"
          >
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="shrink-0 rounded-xl px-3 py-1.5 font-semibold underline underline-offset-4"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
