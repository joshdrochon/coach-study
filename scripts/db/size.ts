// pnpm db:size: reports the database size and warns as it nears the plan limit.

import { readDatabaseSize, sizeSummary, sizeWarning } from '../../src/lib/db/size'

import { connect } from './connect'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('db:size: DATABASE_URL is not set')
  process.exit(2)
}

const db = await connect(url)
try {
  const size = await readDatabaseSize(db.query)
  console.log(`db:size: ${sizeSummary(size)}`)
  const warning = sizeWarning(size.bytes)
  if (warning) console.log(`::warning title=Database size::${warning}`)
} finally {
  await db.close()
}
