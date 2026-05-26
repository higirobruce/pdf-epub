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

async function getPdfjs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist') as typeof import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  return pdfjs
}

async function extractChapters(pdfBuffer: Buffer): Promise<{ chapters: Chapter[]; title: string; author: string }> {
  const pdfjsLib = await getPdfjs()

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise

  const meta = await doc.getMetadata()
  const info = (meta.info || {}) as Record<string, string>
  const pdfTitle = info['Title'] || ''
  const pdfAuthor = info['Author'] || ''

  const chapters: Chapter[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()

    // Group items into lines by Y position (PDF Y axis is bottom-up)
    const lineMap = new Map<number, string[]>()

    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const y = Math.round(item.transform[5])
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push(item.str)
    }

    if (lineMap.size === 0) continue

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
    const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a)
    const lines = sortedYs.map((y) => lineMap.get(y)!.join('').trim()).filter(Boolean)

    const htmlParts = lines.map((line) => {
      const isHeading =
        line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line)
      const safe = escapeHtml(line)
      return isHeading ? `<h2>${safe}</h2>` : `<p>${safe}</p>`
    })

    chapters.push({ pageNum, html: htmlParts.join('\n') })
  }

  return { chapters, title: pdfTitle, author: pdfAuthor }
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
