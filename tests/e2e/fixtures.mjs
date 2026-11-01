// Test files made at run time, with dates relative to today so they never go stale:
// a Word document, an Excel sheet, a CSV, a WhatsApp export, a PDF and two photos.
import fs from 'node:fs'
import { strToU8, zipSync } from 'fflate'

const TZ = 'Asia/Kolkata'
export const dayIso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ })
export const dayLong = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
const ddmmyy = (daysAgo) => {
  const [y, m, d] = dayIso(daysAgo).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function docx(paragraphs, table) {
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`
  const cell = (t) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p></w:tc>`
  const tbl = table ? `<w:tbl>${table.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>` : ''
  const body = paragraphs.map(p).join('') + tbl
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  })
}

function xlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i)
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('')}</row>`)
    .join('')
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Log" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  })
}

/** Writes every fixture into `dir` and returns their paths and what each should produce. */
export async function makeFixtures(dir, browser) {
  fs.mkdirSync(dir, { recursive: true })
  const f = {}

  // Word: a Google Doc saved as .docx, 20 days ago, with a table in the middle.
  f.docx = `${dir}/three-weeks-ago.docx`
  fs.writeFileSync(
    f.docx,
    docx([`Asha's log`, dayLong(20), '6:30 am – BF left 10 min, right 8 min', '7:15 – wet & dirty nappy (yellow)'], [
      ['Time', 'What'],
      ['9:45', 'Fed 60 ml formula'],
      ['10:30', 'Tummy time 10 min'],
    ]),
  )

  // Excel: 19 days ago, one row per entry.
  f.xlsx = `${dir}/sheet-log.xlsx`
  fs.writeFileSync(
    f.xlsx,
    xlsx([
      ['Date', 'Time', 'Activity', 'Amount (ml)', 'Notes'],
      [dayIso(19), '06:40', 'Bottle', 110, 'formula'],
      [dayIso(19), '07:20', 'Diaper', '', 'wet'],
      [dayIso(19), '09:00', 'Nap', '', 'till 10:15'],
    ]),
  )

  // CSV in the style tracking apps export, 18 days ago.
  f.csv = `${dir}/tracker-export.csv`
  fs.writeFileSync(
    f.csv,
    [
      'Type,Start,End,Duration,Start Condition,Start Location,End Condition,Notes',
      `Sleep,${dayIso(18)} 13:00,${dayIso(18)} 14:20,01:20,,Crib,,`,
      `Feed,${dayIso(18)} 15:00,${dayIso(18)} 15:20,00:20,Breast,,"L 10m, R 10m",`,
      `Diaper,${dayIso(18)} 15:30,,,,,Both,`,
    ].join('\n'),
  )

  // WhatsApp chat export (Android style), 17 days ago.
  f.whatsapp = `${dir}/WhatsApp Chat with Mom.txt`
  fs.writeFileSync(
    f.whatsapp,
    [
      `${ddmmyy(17)}, 08:15 - Mom: fed 90ml`,
      `${ddmmyy(17)}, 08:40 - Dad: changed wet nappy`,
      `${ddmmyy(17)}, 09:02 - Mom: <Media omitted>`,
      `${ddmmyy(17)}, 11:30 - Dad: nap 11:30 to 12:45`,
    ].join('\n'),
  )

  // PDF: a different day, 16 days ago, printed from a web page.
  const page = await browser.newPage()
  await page.setContent(
    `<html><body style="font-family: Arial; font-size: 14px"><h2>Feeding log</h2><p>${dayLong(16)}</p><p>6:05 am bottle 120 ml formula</p><p>8:10 am wet diaper</p><p>1:30 pm – 3:00 pm nap</p><p>4:00 pm vit d 1 ml</p></body></html>`,
  )
  f.pdf = `${dir}/feeding-log.pdf`
  await page.pdf({ path: f.pdf, format: 'A4' })

  // Two photos.
  for (const [i, colours] of [
    ['1', '#f6b26b, #e06666'],
    ['2', '#6fa8dc, #8e7cc3'],
  ]) {
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.setContent(`<div style="width:1200px;height:900px;background:linear-gradient(135deg, ${colours});display:grid;place-items:center;font:bold 120px Arial;color:white">Photo ${i}</div>`)
    f[`photo${i}`] = `${dir}/photo-${i}.jpg`
    await page.screenshot({ path: f[`photo${i}`], type: 'jpeg', quality: 80 })
  }
  await page.close()
  return f
}
