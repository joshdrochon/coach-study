import type { MetadataRoute } from 'next'

import { COLOR_VALUES } from '@/styles/tokens'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Coach Study',
    short_name: 'Coach Study',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: COLOR_VALUES.bg,
    theme_color: COLOR_VALUES.bg,
    icons: [
      { src: '/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/app-icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
