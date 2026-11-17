import { testDatabaseProblem } from '@/lib/db/guard'

export default function refuseProductionDatabase(): void {
  const problem = testDatabaseProblem(process.env.DATABASE_URL)
  if (problem) throw new Error(`vitest refused: ${problem}`)
}
