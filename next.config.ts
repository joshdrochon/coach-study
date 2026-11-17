import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,

  serverExternalPackages: ['@electric-sql/pglite'],

  outputFileTracingIncludes: {
    '/voice-test': ['./content/voice-test.json'],
    '/api/voice-test': ['./content/voice-test.json'],
    '/api/tutor/*': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],

    '/api/practice/*': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],
    '/api/flags': ['./content/items/**', './content/reviews/**'],
    '/api/study/*': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],
    '/api/home': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],

    '/api/nudges/send': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],
    '/api/progress': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],
    '/api/admin/learning': [
      './content/items/**',
      './content/passages/**',
      './content/passage-runs.json',
      './content/reviews/**',
    ],
    '/api/avatar': ['./design/assets/default-avatar.jpg'],
    '/*': ['./drizzle/**/*'],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }])
  },
}

export default nextConfig
