const OPENS = String.raw`(^|[\s([{—–\-“‘])`

export function curly(text: string): string {
  return text
    .replace(new RegExp(`${OPENS}"`, 'g'), '$1“')
    .replace(/"/g, '”')
    .replace(new RegExp(`${OPENS}'`, 'g'), '$1‘')
    .replace(/'/g, '’')
}
