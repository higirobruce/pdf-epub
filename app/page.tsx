'use client'

import { useCallback, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'

type Phase = 'idle' | 'uploading' | 'converting' | 'done' | 'error'

function FileIcon() {
  return (
    <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf') {
      setError('Please select a PDF file.')
      return
    }
    setFile(f)
    setPhase('idle')
    setError('')
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) selectFile(f)
    },
    [selectFile]
  )

  const onConvert = async () => {
    if (!file) return

    setPhase('uploading')
    setProgress(0)
    setError('')

    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      })

      setPhase('converting')
      setProgress(0)

      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobUrl: blob.url,
          fileName: file.name,
          title: title.trim() || undefined,
          author: author.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Conversion failed')
      }

      const epubBlob = await res.blob()
      const url = URL.createObjectURL(epubBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name.replace(/\.pdf$/i, '') + '.epub'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setPhase('done')
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const reset = () => {
    setFile(null)
    setPhase('idle')
    setError('')
    setProgress(0)
    setTitle('')
    setAuthor('')
  }

  const busy = phase === 'uploading' || phase === 'converting'

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">PDF → EPUB</h1>
          <p className="mt-2 text-slate-500 text-sm">
            Convert PDF files to readable EPUB e-books
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-6 space-y-5">
          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => !busy && inputRef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center gap-3
              rounded-xl border-2 border-dashed py-10 px-4 cursor-pointer
              transition-colors duration-150
              ${busy ? 'pointer-events-none opacity-60' : ''}
              ${isDragging
                ? 'border-blue-500 bg-blue-50'
                : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50'
              }
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])}
            />
            <FileIcon />
            {file ? (
              <div className="text-center">
                <p className="font-medium text-slate-700 text-sm break-all">{file.name}</p>
                <p className="text-xs text-slate-400 mt-1">{formatSize(file.size)}</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-slate-600 text-sm font-medium">
                  Drag & drop your PDF here
                </p>
                <p className="text-slate-400 text-xs mt-1">or click to browse</p>
              </div>
            )}
          </div>

          {/* Optional metadata */}
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Book title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                text-slate-700 placeholder:text-slate-400 focus:outline-none
                focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
            />
            <input
              type="text"
              placeholder="Author (optional)"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                text-slate-700 placeholder:text-slate-400 focus:outline-none
                focus:ring-2 focus:ring-blue-300 disabled:opacity-50"
            />
          </div>

          {/* Progress bar */}
          {busy && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{phase === 'uploading' ? 'Uploading…' : 'Converting…'}</span>
                {phase === 'uploading' && <span>{progress}%</span>}
              </div>
              {phase === 'uploading' && (
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
              {phase === 'converting' && (
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 animate-pulse w-full" />
                </div>
              )}
            </div>
          )}

          {/* Success message */}
          {phase === 'done' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">
              <CheckIcon />
              <span>EPUB downloaded successfully!</span>
            </div>
          )}

          {/* Error message */}
          {phase === 'error' && error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onConvert}
              disabled={!file || busy}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg
                bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed
                text-white font-medium text-sm py-2.5 transition-colors duration-150"
            >
              {busy ? <Spinner /> : null}
              {phase === 'uploading' ? 'Uploading…' : phase === 'converting' ? 'Converting…' : 'Convert to EPUB'}
            </button>

            {(file || phase === 'done' || phase === 'error') && (
              <button
                onClick={reset}
                disabled={busy}
                className="px-4 rounded-lg border border-slate-200 text-slate-600 text-sm
                  hover:bg-slate-50 disabled:opacity-40 transition-colors duration-150"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Files are deleted from storage immediately after conversion.
        </p>
      </div>
    </main>
  )
}
