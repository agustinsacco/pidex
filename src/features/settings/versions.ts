/**
 * Version comparison for "is there something newer than what pi installed".
 *
 * Deliberately not a full semver implementation: pi packages publish plain
 * dotted versions, and the only question here is whether to offer an Update
 * button. A prerelease sorts below the same plain release.
 */
export function isNewerVersion(latest: string, installed: string): boolean {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core, ...rest] = v.split('-')
    return { nums: core!.split('.').map((n) => parseInt(n, 10) || 0), pre: rest.join('-') }
  }
  const a = parse(latest)
  const b = parse(installed)
  const len = Math.max(a.nums.length, b.nums.length)
  for (let i = 0; i < len; i++) {
    const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  if (a.pre === b.pre) return false
  if (a.pre === '') return true
  if (b.pre === '') return false
  return a.pre > b.pre
}
