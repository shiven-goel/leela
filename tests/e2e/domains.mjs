// Which short web addresses for Leela are still free to register. Asks each registry's own public
// RDAP service, found through IANA's list; "not found" there means nobody has registered the name.
// Usage: node tests/e2e/domains.mjs
const names = [
  'leela.baby',
  'leela.family',
  'leela.care',
  'leelababy.com',
  'leelababy.in',
  'leelaapp.in',
  'getleela.app',
  'myleela.app',
  'leelalog.com',
  'leela.day',
  'heyleela.com',
  'leelatracker.com',
]

const headers = { accept: 'application/rdap+json, application/json', 'user-agent': 'leela-domain-check/1.0 (+https://github.com/shiven-goel/leela)' }
const bootstrap = await (await fetch('https://data.iana.org/rdap/dns.json', { headers, signal: AbortSignal.timeout(20_000) })).json()
const serverFor = (tld) => bootstrap.services.find(([tlds]) => tlds.includes(tld))?.[1]?.[0]

const rows = []
for (const name of names) {
  const tld = name.split('.').pop()
  const base = serverFor(tld)
  let status
  if (!base) status = 'unknown (no public lookup for this ending)'
  else {
    try {
      const r = await fetch(`${base.replace(/\/?$/, '/')}domain/${name}`, { headers, signal: AbortSignal.timeout(15_000) })
      status = r.status === 200 ? 'taken' : r.status === 404 ? 'looks free' : `unknown (${r.status})`
    } catch (e) {
      status = `unknown (${e.name})`
    }
  }
  rows.push(`${name.padEnd(20)} ${status}`)
}
console.log(`Checked ${new Date().toISOString().slice(0, 10)} with each registry's RDAP service. "Looks free" means no registration was found; confirm at a registrar.\n`)
console.log(rows.join('\n'))
