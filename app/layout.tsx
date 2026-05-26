import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PDF to EPUB Converter',
  description: 'Convert PDF files to EPUB format — free and private.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
