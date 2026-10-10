// Turns a job description into the text the scoring model should read first:
// requirement-style sections (requirements, qualifications, skills, …) ahead
// of the company intro, cut to a character budget. Postings often put the
// requirements after a long intro, which a plain prefix cut never reaches.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

// Block-level tags become line breaks so headings stay on their own line;
// list items keep a "- " marker. Other tags are dropped.
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*(br|\/?p|\/?div|\/li|\/?h[1-6]|\/?tr|\/?ul|\/?ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 0 && line !== '-')
    .join('\n')
}

// Headings whose section says what the job needs, in a few major languages.
// Matched at the start of a short line, after an optional "your", "key", …
const REQUIREMENT_HEADINGS = [
  // en
  'requirements?', 'qualifications?', 'skills?', 'experience', 'responsibilities',
  "what we(?:'|’)re looking for", 'must[- ]haves?',
  "what you(?:(?:'|’)ll| will)? (?:need|bring|do|work on|have)", "you(?:(?:'|’)ll| will)? (?:need|bring|have)",
  'what we(?: are)? looking for', 'what we need',
  'about you', 'who you are', 'profile', 'duties', 'selection criteria', 'criteria',
  'successful (?:applicant|candidate)', 'to be successful', 'ideal candidate',
  // de
  'anforderungen', 'qualifikationen', 'ihr profil', 'dein profil', 'aufgaben', 'das bringst du mit',
  // fr
  'profil recherché', 'exigences', 'compétences', 'missions', 'qualifications requises',
  // es / pt
  'requisitos', 'perfil', 'responsabilidades', 'funciones', 'qualificações',
  // nl
  'functie-eisen', 'vereisten', 'wat wij vragen', 'profiel',
  // ar
  'المتطلبات', 'المؤهلات', 'المسؤوليات',
]

// Headings that end a requirement section without starting one.
const OTHER_HEADINGS = [
  'benefits', 'perks', 'what we offer', 'we offer', 'about', 'who we are', 'why', 'life at',
  'role', 'position', 'how to apply', 'salary', 'compensation',
]

const PREFIX = "(?:your |our |the |key |main |minimum |essential |desired |preferred |required |core )?"
const startsWith = (words: string[]) => new RegExp(`^${PREFIX}(?:${words.join('|')})(?![\\p{L}])`, 'iu')
const REQUIREMENT_RE = startsWith(REQUIREMENT_HEADINGS)
const OTHER_RE = startsWith(OTHER_HEADINGS)

const KEYWORD_HEADING_MAX = 60
const COLON_HEADING_MAX = 80

type Heading = 'requirement' | 'other' | null

function headingKind(line: string): Heading {
  if (line.startsWith('- ')) return null
  const keywordSized = line.length <= KEYWORD_HEADING_MAX
  if (keywordSized && REQUIREMENT_RE.test(line)) return 'requirement'
  if (keywordSized && OTHER_RE.test(line)) return 'other'
  if (line.length <= COLON_HEADING_MAX && line.endsWith(':')) return 'other'
  return null
}

// Cuts at the last line break or space in the final 20% of the budget, so the
// text doesn't stop mid-word; otherwise a hard cut.
function cut(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const hard = text.slice(0, maxChars)
  const at = Math.max(hard.lastIndexOf('\n'), hard.lastIndexOf(' '))
  return at >= maxChars * 0.8 ? hard.slice(0, at) : hard
}

export function relevantJobText(description: string | null | undefined, maxChars: number): string {
  if (!description) return ''
  const lines = htmlToText(description).split('\n')

  const first: string[] = []
  const rest: string[] = []
  let inRequirements = false
  for (const line of lines) {
    const kind = headingKind(line)
    if (kind) inRequirements = kind === 'requirement'
    ;(inRequirements ? first : rest).push(line)
  }
  return cut([...first, ...rest].join('\n'), maxChars)
}
