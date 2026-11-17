import { passcodeMatches } from './passcode'

export function bearerMatches(header: string | null, secret: string): boolean {
  if (header === null || secret.length === 0) return false
  const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1]
  return token !== undefined && passcodeMatches(token, secret)
}
