import { describe, expect, it } from 'vitest'
import { htmlToText, relevantJobText } from '@/lib/job-text'

describe('htmlToText', () => {
  it('keeps headings and list items on their own lines and decodes entities', () => {
    const html = '<h3>Requirements</h3><ul><li>Figma &amp; Sketch</li><li>3+ years</li></ul><p>Pay&nbsp;is &lt;good&gt;</p>'
    expect(htmlToText(html)).toBe('Requirements\n- Figma & Sketch\n- 3+ years\nPay is <good>')
  })

  it('leaves plain text alone apart from whitespace', () => {
    expect(htmlToText('  Line one  \n\n  Line   two ')).toBe('Line one\nLine two')
  })
})

describe('relevantJobText', () => {
  const intro = 'Acme has been making widgets since 1950 and is loved by many.'

  it('moves requirement sections ahead of the intro', () => {
    const text = `${intro}\nWhat you need\n- NMC registration\n- 2 years ICU\nWhat we offer\n- Pension`
    expect(relevantJobText(text, 1500)).toBe(
      `What you need\n- NMC registration\n- 2 years ICU\n${intro}\nWhat we offer\n- Pension`
    )
  })

  it('recognises colon headings, heading prefixes and other languages', () => {
    expect(relevantJobText(`${intro}\nTo be successful you will need:\n- A licence`, 1500)).toMatch(/^To be successful/)
    expect(relevantJobText(`${intro}\nKey Responsibilities\n- Audits`, 1500)).toMatch(/^Key Responsibilities/)
    expect(relevantJobText(`${intro}\nIhr Profil\n- Deutsch C2`, 1500)).toMatch(/^Ihr Profil/)
    expect(relevantJobText(`${intro}\nRequisitos:\n- Inglés`, 1500)).toMatch(/^Requisitos/)
  })

  it('ends a requirement section at the next non-requirement heading', () => {
    const text = `Requirements\n- CPA\nAbout us\nWe are big.\nBenefits:\n- Gym`
    expect(relevantJobText(text, 1500)).toBe(text)
    const reordered = relevantJobText(`About us\nWe are big.\nRequirements\n- CPA\nBenefits:\n- Gym`, 1500)
    expect(reordered).toBe('Requirements\n- CPA\nAbout us\nWe are big.\nBenefits:\n- Gym')
  })

  it('does not treat a sentence or bullet that mentions experience as a heading', () => {
    const text = `${intro}\nWe offer 5 years of experience in a fun team.\n- Experience with Excel`
    expect(relevantJobText(text, 1500)).toBe(text)
  })

  it('keeps the original order when there are no requirement headings', () => {
    expect(relevantJobText(`${intro}\nSecond line.`, 1500)).toBe(`${intro}\nSecond line.`)
  })

  it('cuts to the budget at a word boundary', () => {
    const text = 'word '.repeat(400)
    const out = relevantJobText(text, 1000)
    expect(out.length).toBeLessThanOrEqual(1000)
    expect(out.length).toBeGreaterThan(800)
    expect(out.endsWith('word')).toBe(true)
  })

  it('hard-cuts a long run with no spaces', () => {
    expect(relevantJobText('x'.repeat(2000), 1500)).toHaveLength(1500)
  })

  it('returns an empty string for no description', () => {
    expect(relevantJobText(null, 1500)).toBe('')
    expect(relevantJobText('', 1500)).toBe('')
  })
})
