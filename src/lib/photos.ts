// Photos live in the family's private folder. Re-encoding through a canvas strips location data.
import { getState } from './store'
import { supabase } from './supabase'
import { uuid } from './uuid'

const MAX_EDGE = 1800

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error('This photo format isn’t supported. Try a JPG or PNG.')
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read that photo.'))), 'image/jpeg', 0.86),
  )
}

export async function uploadPhoto(file: File): Promise<string> {
  const s = getState()
  if (!s.family) throw new Error('Join a family first.')
  if (!navigator.onLine) throw new Error('Photos need a connection. Save the entry now and add the photo later.')
  const blob = await toJpeg(file)
  const path = `${s.family.id}/photos/${uuid()}.jpg`
  const { error } = await supabase.storage.from('family').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

const urlCache = new Map<string, { url: string; expires: number }>()

export async function photoUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path)
  if (hit && hit.expires > Date.now() + 60_000) return hit.url
  const { data, error } = await supabase.storage.from('family').createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 3600_000 })
  return data.signedUrl
}
