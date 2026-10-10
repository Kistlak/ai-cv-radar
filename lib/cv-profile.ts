import type { CvStructured } from './ai/schemas'

// The CV as the scoring model reads it: a compact header from the parsed CV
// (so location, skills and recent roles are never cut off), then the raw text
// for detail, within one character budget.

const MAX_ROLES = 4

export function cvProfileText(
  profile: CvStructured | null,
  rawText: string,
  maxChars = 6000
): string {
  if (!profile) return rawText.slice(0, maxChars)

  const lines = ['PROFILE']
  if (profile.location) lines.push(`Location: ${profile.location}`)
  if (profile.summary) lines.push(`Summary: ${profile.summary}`)
  if (profile.skills.length > 0) lines.push(`Skills: ${profile.skills.join(', ')}`)
  const roles = profile.experience.slice(0, MAX_ROLES)
  if (roles.length > 0) {
    lines.push('Recent roles:')
    for (const r of roles) {
      lines.push(`- ${[r.role, r.company].filter(Boolean).join(', ')}${r.period ? ` (${r.period})` : ''}`)
    }
  }
  if (profile.education.length > 0) {
    lines.push('Education:')
    for (const e of profile.education) {
      lines.push(`- ${[e.degree, e.institution].filter(Boolean).join(', ')}${e.year ? ` (${e.year})` : ''}`)
    }
  }
  lines.push('', 'FULL CV TEXT', rawText)
  return lines.join('\n').slice(0, maxChars)
}
