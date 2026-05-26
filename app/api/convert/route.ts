import { del } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { convertPdfToEpub } from '@/lib/pdf-to-epub'

export const maxDuration = 60

export async function POST(request: Request) {
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

    // Best-effort cleanup — don't block the response
    del(blobUrl).catch(() => {})

    const outName = (fileName ?? 'converted').replace(/\.pdf$/i, '') + '.epub'

    return new Response(epubBuffer.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${outName}"`,
        'Content-Length': String(epubBuffer.length),
      },
    })
  } catch (error) {
    del(blobUrl).catch(() => {})
    return NextResponse.json(
      { error: 'Conversion failed: ' + (error as Error).message },
      { status: 500 }
    )
  }
}
