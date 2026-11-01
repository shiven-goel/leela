import { Camera, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { photoUrl, uploadPhoto } from '../lib/photos'

export function PhotoThumb({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void photoUrl(path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])
  return url ? (
    <img src={url} alt="" className={className ?? 'h-full w-full object-cover'} loading="lazy" />
  ) : (
    <div className={`${className ?? 'h-full w-full'} animate-pulse bg-card-2`} />
  )
}

export function PhotoPicker({ paths, onChange, max = 4 }: { paths: string[]; onChange: (p: string[]) => void; max?: number }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).slice(0, max - paths.length)
    setBusy({ done: 0, total: list.length })
    setError(null)
    const next = [...paths]
    let failed = 0
    let lastError = ''
    // Each photo is kept as soon as it's uploaded, so one bad file doesn't lose the rest.
    for (const [i, f] of list.entries()) {
      try {
        next.push(await uploadPhoto(f))
        onChange([...next])
      } catch (e) {
        failed++
        lastError = e instanceof Error ? e.message : 'Couldn’t add that photo.'
      }
      setBusy({ done: i + 1, total: list.length })
    }
    if (failed) setError(failed === list.length ? lastError : `${failed} of ${list.length} photos couldn’t be added. ${lastError}`)
    if (files.length > list.length) setError(`Up to ${max} photos here. The first ${list.length} were added.`)
    setBusy(null)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="mb-5">
      <div className="mb-2 text-[15px] font-semibold text-ink-2">Photos</div>
      <div className="flex flex-wrap gap-2">
        {paths.map((p) => (
          <div key={p} className="relative h-20 w-20 overflow-hidden rounded-2xl">
            <PhotoThumb path={p} />
            <button
              type="button"
              onClick={() => onChange(paths.filter((x) => x !== p))}
              className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white"
              aria-label="Remove photo"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        ))}
        {paths.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy !== null}
            className="grid h-20 w-20 place-items-center rounded-2xl bg-card-2 text-ink-2 ring-1 ring-line ring-dashed"
          >
            <span className="flex flex-col items-center gap-1 text-[13px] font-semibold">
              <Camera size={24} weight="duotone" />
              {busy ? `${busy.done} of ${busy.total}` : 'Add'}
            </span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
      {error && <p className="mt-2 text-sm text-[var(--health)]">{error}</p>}
    </div>
  )
}
