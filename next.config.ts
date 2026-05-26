import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep pdfjs-dist out of the bundler — it runs as native Node.js module
  serverExternalPackages: ['pdfjs-dist'],
}

export default nextConfig
