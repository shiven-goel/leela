import { useState, type ReactNode } from 'react'

/** A titled chart with optional figures, a legend and a table of every number behind it. */
export function ChartCard({
  title,
  sub,
  stats,
  legend,
  table,
  children,
}: {
  title: string
  sub?: string
  stats?: { label: string; value: string }[]
  legend?: { label: string; swatch: ReactNode }[]
  table?: { head: string[]; rows: (string | number)[][] }
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <section className="mb-4 rounded-[26px] bg-card p-4" aria-label={title}>
      <h3 className="font-display text-[20px] font-bold leading-tight">{title}</h3>
      {sub && <p className="text-[14px] text-ink-2">{sub}</p>}
      {stats && stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="truncate text-[13px] text-ink-2">{s.label}</dt>
              <dd className="text-[19px] font-bold leading-tight">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3">{children}</div>
      {legend && legend.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              {l.swatch}
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {table && table.rows.length > 0 && (
        <>
          <button type="button" onClick={() => setShowTable((v) => !v)} className="mt-3 text-[14px] font-semibold text-brand" aria-expanded={showTable}>
            {showTable ? 'Hide the numbers' : 'Show the numbers'}
          </button>
          {showTable && (
            <div className="mt-2 max-h-72 overflow-auto rounded-2xl ring-1 ring-line">
              <table className="w-full text-left text-[14px]">
                <thead className="sticky top-0 bg-card-2">
                  <tr>
                    {table.head.map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-semibold text-ink-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {r.map((c, j) => (
                        <td key={j} className="num px-3 py-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function Key({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
  ) : (
    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden="true" />
  )
}
