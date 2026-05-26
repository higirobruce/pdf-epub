import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'

// GET — lets the client check whether Blob Storage is configured
export async function GET() {
  return NextResponse.json({ configured: !!process.env.BLOB_READ_WRITE_TOKEN })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Blob Storage is not configured on this deployment.' },
      { status: 503 }
    )
  }

  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        if (!pathname.toLowerCase().endsWith('.pdf')) {
          throw new Error('Only PDF files are allowed')
        }
        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: 200 * 1024 * 1024, // 200 MB
        }
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url)
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
