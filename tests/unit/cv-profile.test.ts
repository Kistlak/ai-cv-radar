import { describe, expect, it } from 'vitest'
import { CvStructuredSchema } from '@/lib/ai/schemas'
import { cvProfileText } from '@/lib/cv-profile'

const profile = CvStructuredSchema.parse({
  name: 'A',
  location: 'Lisbon, Portugal',
  summary: 'UX designer, 4 years.',
  skills: ['Figma', 'Usability testing'],
  experience: [
    { role: 'UX/UI Designer', company: 'Pagaleve', period: '2024 - Present' },
    { role: 'Product Designer', company: 'Maré', period: null },
    { role: 'UI Designer', company: 'Fórmula', period: '2021 - 2022' },
    { role: 'Intern', company: 'Old Co', period: '2020' },
    { role: 'Volunteer', company: 'Oldest Co', period: '2019' },
  ],
  education: [{ degree: 'MSc HCI', institution: 'Lisboa', year: '2021' }],
})

describe('cvProfileText', () => {
  it('puts a compact profile before the raw text', () => {
    const text = cvProfileText(profile, 'RAW CV')
    expect(text).toBe(
      [
        'PROFILE',
        'Location: Lisbon, Portugal',
        'Summary: UX designer, 4 years.',
        'Skills: Figma, Usability testing',
        'Recent roles:',
        '- UX/UI Designer, Pagaleve (2024 - Present)',
        '- Product Designer, Maré',
        '- UI Designer, Fórmula (2021 - 2022)',
        '- Intern, Old Co (2020)',
        'Education:',
        '- MSc HCI, Lisboa (2021)',
        '',
        'FULL CV TEXT',
        'RAW CV',
      ].join('\n')
    )
  })

  it('omits empty fields', () => {
    const text = cvProfileText(CvStructuredSchema.parse({ skills: ['Excel'] }), 'RAW')
    expect(text).toBe('PROFILE\nSkills: Excel\n\nFULL CV TEXT\nRAW')
  })

  it('caps the total length', () => {
    expect(cvProfileText(profile, 'x'.repeat(10_000))).toHaveLength(6000)
    expect(cvProfileText(profile, 'x'.repeat(10_000), 500)).toHaveLength(500)
  })

  it('uses the raw text alone without a profile', () => {
    expect(cvProfileText(null, 'x'.repeat(7000))).toBe('x'.repeat(6000))
  })
})
