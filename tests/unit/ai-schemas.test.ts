import { describe, expect, it } from 'vitest'
import { extractJson } from '@/lib/ai/parse-json'
import { CvJsonSchema, CvStructuredSchema, DeepDiveSchema } from '@/lib/ai/schemas'
import { isCvJson, parseCvJson } from '@/lib/cv-docx'

describe('extractJson', () => {
  it('finds an object inside prose or code fences', () => {
    expect(extractJson('Here:\n```json\n{"a": 1}\n```', 'object')).toEqual({ a: 1 })
  })

  it('finds an array', () => {
    expect(extractJson('result: ["x", "y"] done', 'array')).toEqual(['x', 'y'])
  })

  it('throws when there is no JSON of that kind', () => {
    expect(() => extractJson('no json here', 'object')).toThrow()
    expect(() => extractJson('{"a": 1}', 'array')).toThrow()
  })

  it('throws on malformed JSON', () => {
    expect(() => extractJson('{"a": }', 'object')).toThrow()
  })
})

describe('CvStructuredSchema (upload parse)', () => {
  const valid = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    location: null,
    summary: 'Backend engineer',
    skills: ['PHP', 'Laravel'],
    experience: [{ role: 'Engineer', company: 'Acme', period: '2020–2024', description: null }],
    education: [{ degree: 'BSc CS', institution: 'Uni', year: '2019' }],
  }

  it('accepts a normal parse', () => {
    expect(CvStructuredSchema.parse(valid)).toEqual(valid)
  })

  it('normalises missing optional fields and lists', () => {
    const out = CvStructuredSchema.parse({ name: 'Jane' })
    expect(out).toEqual({
      name: 'Jane',
      email: null,
      location: null,
      summary: null,
      skills: [],
      experience: [],
      education: [],
    })
  })

  it('drops non-string skills and non-object experience items', () => {
    const out = CvStructuredSchema.parse({ ...valid, skills: ['PHP', 3, null], experience: ['junk', valid.experience[0]] })
    expect(out.skills).toEqual(['PHP'])
    expect(out.experience).toHaveLength(1)
  })

  it('fills missing text inside list items with an empty string', () => {
    const out = CvStructuredSchema.parse({ ...valid, experience: [{ role: null, company: 'Acme' }] })
    expect(out.experience[0]).toEqual({ role: '', company: 'Acme', period: null, description: null })
  })

  it('keeps a parse with no name (name becomes empty)', () => {
    expect(CvStructuredSchema.parse({ ...valid, name: undefined }).name).toBe('')
    expect(CvStructuredSchema.parse({ ...valid, name: null }).name).toBe('')
    expect(CvStructuredSchema.parse({ ...valid, name: '  Jane  ' }).name).toBe('Jane')
  })

  it('rejects output that is not an object or has a non-text name', () => {
    expect(CvStructuredSchema.safeParse([]).success).toBe(false)
    expect(CvStructuredSchema.safeParse('Jane').success).toBe(false)
    expect(CvStructuredSchema.safeParse({ ...valid, name: 42 }).success).toBe(false)
  })
})

describe('CvJsonSchema (tailored / general CV)', () => {
  const valid = {
    name: 'Jane Doe',
    title: 'Senior Backend Engineer',
    summary: 'Eight years building APIs.',
    contact: { email: 'jane@example.com', linkedin: 'linkedin.com/in/jane' },
    experience: [{ company: 'Acme', title: 'Engineer', startDate: '2020', endDate: 'Present', bullets: ['Built X'] }],
    education: [{ institution: 'Uni', degree: 'BSc CS', year: '2019' }],
    skills: ['PHP'],
  }

  it('accepts a normal CV and keeps certifications optional', () => {
    const out = CvJsonSchema.parse(valid)
    expect(out.name).toBe('Jane Doe')
    expect(out.certifications).toBeUndefined()
    expect(CvJsonSchema.parse({ ...valid, certifications: ['AWS SA'] }).certifications).toEqual(['AWS SA'])
  })

  it('turns null contact fields into undefined', () => {
    const out = CvJsonSchema.parse({ ...valid, contact: { email: null, phone: 'x' } })
    expect(out.contact).toEqual({ email: undefined, phone: 'x', location: undefined, linkedin: undefined, website: undefined })
  })

  it('defaults missing bullets and lists', () => {
    const out = CvJsonSchema.parse({ ...valid, experience: [{ company: 'Acme', title: 'Eng' }], skills: undefined })
    expect(out.experience[0].bullets).toEqual([])
    expect(out.skills).toEqual([])
  })

  it('rejects CVs missing required top-level fields (same as the old isCvJson)', () => {
    expect(CvJsonSchema.safeParse({ ...valid, title: undefined }).success).toBe(false)
    expect(CvJsonSchema.safeParse({ ...valid, contact: null }).success).toBe(false)
    expect(CvJsonSchema.safeParse({ ...valid, summary: 5 }).success).toBe(false)
  })

  it('backs isCvJson and parseCvJson', () => {
    expect(isCvJson(valid)).toBe(true)
    expect(isCvJson({ name: 'x' })).toBe(false)
    expect(parseCvJson(valid)?.title).toBe('Senior Backend Engineer')
    expect(parseCvJson('nope')).toBeNull()
  })
})

describe('DeepDiveSchema', () => {
  it('accepts a deep dive and drops non-string bullets', () => {
    const out = DeepDiveSchema.parse({ fitSummary: 'Good fit', strengths: ['A', 1], gaps: [], emphasis: ['B'] })
    expect(out).toEqual({ fitSummary: 'Good fit', strengths: ['A'], gaps: [], emphasis: ['B'] })
  })

  it('defaults missing lists', () => {
    expect(DeepDiveSchema.parse({ fitSummary: 'x' }).gaps).toEqual([])
  })

  it('requires the summary', () => {
    expect(DeepDiveSchema.safeParse({ strengths: [] }).success).toBe(false)
  })
})
