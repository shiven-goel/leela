// The phone's back button steps out of the top layer (a sheet or a full screen) instead of
// leaving the app. One listener owns the history entries so layers never trip over each other.

interface Layer {
  id: string
  onBack: () => boolean | void
  popped: boolean
}

const stack: Layer[] = []
/** Pops we caused ourselves (closing a layer from a button), not the person pressing back. */
let ownPops = 0
let listening = false

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', () => {
    if (ownPops > 0) {
      ownPops--
      return
    }
    const top = stack[stack.length - 1]
    if (!top) return
    if (top.onBack() === true) {
      // The layer handled it (stepped back inside itself) and stays open.
      window.history.pushState({ leelaLayer: top.id }, '')
      return
    }
    top.popped = true
  })
}

/** Entries waiting to be taken off history. Deferred a moment so a layer that closes and another
 * that opens in the same instant (one sheet swapping for the next, or React mounting twice in
 * development) share one entry instead of racing history.back() against history.pushState(). */
let pendingPops = 0
let popTimer: ReturnType<typeof setTimeout> | undefined

export function pushLayer(onBack: () => boolean | void): Layer {
  listen()
  const layer: Layer = { id: Math.random().toString(36).slice(2), onBack, popped: false }
  stack.push(layer)
  if (pendingPops > 0) {
    pendingPops--
    window.history.replaceState({ leelaLayer: layer.id }, '')
  } else {
    window.history.pushState({ leelaLayer: layer.id }, '')
  }
  return layer
}

export function popLayer(layer: Layer) {
  const i = stack.indexOf(layer)
  if (i >= 0) stack.splice(i, 1)
  if (layer.popped) return
  pendingPops++
  clearTimeout(popTimer)
  popTimer = setTimeout(() => {
    const n = pendingPops
    pendingPops = 0
    if (n > 0) {
      ownPops++
      window.history.go(-n)
    }
  }, 0)
}
