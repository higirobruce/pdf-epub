import JSZip from 'jszip'

interface ConvertOptions {
  title?: string
  author?: string
}

interface Chapter {
  pageNum: number
  html: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Remove characters pdfjs can't map to Unicode (shown as □ in e-readers)
function cleanStr(str: string): string {
  return str
    .replace(/[-]/g, '') // Private Use Area — unmapped glyphs
    .replace(/�/g, '')           // Unicode replacement character
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // stray control chars
}

async function getPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist') as typeof import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  return pdfjs
}

async function extractChapters(pdfBuffer: Buffer): Promise<{ chapters: Chapter[]; title: string; author: string }> {
  const pdfjsLib = await getPdfjs()

  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise

  const meta = await doc.getMetadata()
  const info = (meta.info || {}) as Record<string, string>

  const chapters: Chapter[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()

    // Group text items into lines by rounded Y position (PDF Y is bottom-up)
    const lineMap = new Map<number, string[]>()
    for (const item of content.items) {
      if (!('str' in item)) continue
      const s = cleanStr(item.str)
      if (!s) continue
      const y = Math.round(item.transform[5])
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push(s)
    }
    if (lineMap.size === 0) continue

    // Build sorted (top→bottom) line list with their Y positions
    const lines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0]) // higher Y = higher on page
      .map(([y, parts]) => ({ y, text: parts.join('').trim() }))
      .filter((l) => l.text.length > 0)

    if (lines.length === 0) continue

    // Detect typical line spacing so we can recognise paragraph breaks
    const gaps = lines.slice(0, -1).map((l, i) => l.y - lines[i + 1].y)
    const sorted = [...gaps].sort((a, b) => a - b)
    const medianGap = sorted[Math.floor(sorted.length / 2)] ?? 12
    const paraBreakThreshold = medianGap * 1.4 // gap > 1.4× median → new paragraph

    // Merge PDF lines into logical paragraphs
    const paragraphs: string[] = []
    let current = lines[0].text

    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y

      if (gap > paraBreakThreshold) {
        // Paragraph boundary
        paragraphs.push(current)
        current = lines[i].text
      } else if (current.endsWith('-')) {
        // De-hyphenate split words (e.g. "his-\ntory" → "history")
        current = current.slice(0, -1) + lines[i].text
      } else {
        // Same paragraph — join with a space
        current += ' ' + lines[i].text
      }
    }
    paragraphs.push(current)

    const htmlParts = paragraphs
      .map((para) => {
        const text = para.trim()
        if (!text) return ''
        const safe = escapeHtml(text)
        const isHeading = text.length < 80 && text === text.toUpperCase() && /[A-Z]/.test(text)
        return isHeading ? `<h2>${safe}</h2>` : `<p>${safe}</p>`
      })
      .filter(Boolean)

    if (htmlParts.length > 0) {
      chapters.push({ pageNum, html: htmlParts.join('\n') })
    }
  }

  return { chapters, title: info['Title'] || '', author: info['Author'] || '' }
}

function buildEpubXml(id: string, title: string, author: string, chapterIds: string[]): string {
  const manifestItems = chapterIds
    .map((cid) => `    <item id="${cid}" href="chapters/${cid}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n')

  const spineItems = chapterIds.map((cid) => `    <itemref idref="${cid}"/>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:creator>${escapeHtml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
${spineItems}
  </spine>
</package>`
}

function buildNav(title: string, chapterIds: string[]): string {
  const navItems = chapterIds
    .map((cid, i) => `      <li><a href="chapters/${cid}.xhtml">Page ${i + 1}</a></li>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeHtml(title)}</title></head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`
}

function buildNcx(id: string, title: string, chapterIds: string[]): string {
  const navPoints = chapterIds
    .map(
      (cid, i) => `  <navPoint id="np-${i + 1}" playOrder="${i + 1}">
    <navLabel><text>Page ${i + 1}</text></navLabel>
    <content src="chapters/${cid}.xhtml"/>
  </navPoint>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
}

function buildChapterXhtml(pageNum: number, html: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${pageNum}</title>
  <style>
    body { font-family: serif; line-height: 1.6; margin: 1em 2em; }
    h2 { font-size: 1.2em; font-weight: bold; margin: 1.5em 0 0.5em; }
    p { margin: 0.4em 0; }
  </style>
</head>
<body>
${html}
</body>
</html>`
}

export async function convertPdfToEpub(pdfBuffer: Buffer, options: ConvertOptions = {}): Promise<Buffer> {
  const { chapters, title: pdfTitle, author: pdfAuthor } = await extractChapters(pdfBuffer)

  if (chapters.length === 0) {
    throw new Error('No readable text found in this PDF')
  }

  const title = options.title || pdfTitle || 'Untitled'
  const author = options.author || pdfAuthor || 'Unknown'
  const bookId = `urn:uuid:${Date.now()}-${Math.random().toString(36).slice(2)}`

  const chapterIds = chapters.map((ch) => `page-${String(ch.pageNum).padStart(4, '0')}`)

  const zip = new JSZip()

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  )

  const epubFolder = zip.folder('EPUB')!
  epubFolder.file('content.opf', buildEpubXml(bookId, title, author, chapterIds))
  epubFolder.file('nav.xhtml', buildNav(title, chapterIds))
  epubFolder.file('toc.ncx', buildNcx(bookId, title, chapterIds))

  const chaptersFolder = epubFolder.folder('chapters')!
  for (let i = 0; i < chapters.length; i++) {
    chaptersFolder.file(
      `${chapterIds[i]}.xhtml`,
      buildChapterXhtml(chapters[i].pageNum, chapters[i].html)
    )
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
  })

  return buffer
}
