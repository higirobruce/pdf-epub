import { del } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { convertPdfToEpub } from '@/lib/pdf-to-epub'

export const maxDuration = 60

async function respond(epubBuffer: Buffer, outName: string) {
  return new Response(epubBuffer.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename="${outName}"`,
      'Content-Length': String(epubBuffer.length),
    },
  })
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  // ── Direct upload (no Blob Storage required, works up to ~4 MB) ──
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    const title = (form.get('title') as string | null) ?? undefined
    const author = (form.get('author') as string | null) ?? undefined
    const fileName = (form.get('fileName') as string | null) ?? 'converted.pdf'

    const pdfBuffer = Buffer.from(await file.arrayBuffer())

    try {
      const epubBuffer = await convertPdfToEpub(pdfBuffer, { title, author })
      const outName = fileName.replace(/\.pdf$/i, '') + '.epub'
      return respond(epubBuffer, outName)
    } catch (error) {
      return NextResponse.json(
        { error: 'Conversion failed: ' + (error as Error).message },
        { status: 500 }
      )
    }
  }

  // ── Blob URL upload (large files via Vercel Blob Storage) ──
  const { blobUrl, fileName, title, author } = (await request.json()) as {
    blobUrl: string
    fileName?: string
    title?: string
    author?: string
  }

  if (!blobUrl) {
    return NextResponse.json({ error: 'No blob URL provided' }, { status: 400 })
  }

  const pdfResponse = await fetch(blobUrl)
  if (!pdfResponse.ok) {
    return NextResponse.json({ error: 'Failed to retrieve uploaded file' }, { status: 500 })
  }

  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())

  try {
    const epubBuffer = await convertPdfToEpub(pdfBuffer, { title, author })
    del(blobUrl).catch(() => {})
    const outName = (fileName ?? 'converted').replace(/\.pdf$/i, '') + '.epub'
    return respond(epubBuffer, outName)
  } catch (error) {
    del(blobUrl).catch(() => {})
    return NextResponse.json(
      { error: 'Conversion failed: ' + (error as Error).message },
      { status: 500 }
    )
  }
}
