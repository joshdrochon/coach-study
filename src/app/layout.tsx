import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { HydrationMark } from '@/components/HydrationMark'
import { COLOR_VALUES } from '@/styles/tokens'

import { nimbusSansNarrow } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Coach Study', template: '%s · Coach Study' },
  description: 'Private study app',
  robots: { index: false, follow: false },
  applicationName: 'Coach Study',
  appleWebApp: { capable: true, title: 'Coach Study', statusBarStyle: 'black' },
}

export const viewport: Viewport = {
  themeColor: COLOR_VALUES.bg,
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={nimbusSansNarrow.variable}>
      <body>
        {children}
        <HydrationMark />
      </body>
    </html>
  )
}
