import localFont from 'next/font/local'

export const nimbusSansNarrow = localFont({
  src: '../../design/assets/fonts/NimbusSansNarrow-Bold.otf',
  weight: '700',
  style: 'normal',
  display: 'swap',
  variable: '--font-nimbus-sans-narrow',
  adjustFontFallback: 'Arial',
})
