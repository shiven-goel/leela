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

export function pushLayer(onBack: () => boolean | void): Layer {
  listen()
  const layer: Layer = { id: Math.random().toString(36).slice(2), onBack, popped: false }
  stack.push(layer)
  window.history.pushState({ leelaLayer: layer.id }, '')
  return layer
}

export function popLayer(layer: Layer) {
  const i = stack.indexOf(layer)
  if (i >= 0) stack.splice(i, 1)
  if (!layer.popped) {
    ownPops++
    window.history.back()
  }
}
