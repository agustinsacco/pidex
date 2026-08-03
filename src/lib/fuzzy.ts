/** Lightweight subsequence fuzzy matcher with basename/boundary bonuses. */

export interface FuzzyResult<T> {
  item: T
  score: number
}

export function fuzzyMatch(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      streak++
      score += 2 + streak // consecutive matches compound
      if (
        ti === 0 ||
        t[ti - 1] === '/' ||
        t[ti - 1] === '-' ||
        t[ti - 1] === '_' ||
        t[ti - 1] === '.'
      ) {
        score += 6 // boundary bonus
      }
    } else {
      streak = 0
    }
  }
  if (qi < q.length) return null
  // Prefer shorter targets and matches near the end (basenames).
  score -= Math.floor(target.length / 8)
  const slash = target.lastIndexOf('/')
  if (slash !== -1 && t.slice(slash + 1).includes(q[0]!)) score += 3
  return score
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
  limit = 50,
): T[] {
  if (!query) return items.slice(0, limit)
  const results: FuzzyResult<T>[] = []
  for (const item of items) {
    const score = fuzzyMatch(query, key(item))
    if (score !== null) results.push({ item, score })
  }
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit).map((r) => r.item)
}
