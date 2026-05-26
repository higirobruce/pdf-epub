import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep pdfjs-dist out of webpack so it runs as native ESM in Node.js
  serverExternalPackages: ['pdfjs-dist'],
  webpack: (config) => {
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    return config
  },
}

export default nextConfig
