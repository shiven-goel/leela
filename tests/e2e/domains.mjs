// Which short web addresses for Leela are still free to register, from the public RDAP registry
// lookup (404 there means nobody has registered the name). Usage: node tests/e2e/domains.mjs
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

const rows = []
for (const name of names) {
  let status
  try {
    const r = await fetch(`https://rdap.org/domain/${name}`, { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(15_000) })
    status = r.status === 200 ? 'taken' : r.status === 404 ? 'looks free' : `unknown (${r.status})`
  } catch (e) {
    status = `unknown (${e.name})`
  }
  rows.push(`${name.padEnd(20)} ${status}`)
}
console.log(`Checked ${new Date().toISOString().slice(0, 10)} via rdap.org. "Looks free" means no registration was found; confirm at a registrar.\n`)
console.log(rows.join('\n'))
