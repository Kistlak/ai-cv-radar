import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
} from 'docx'

export interface CvJson {
  name: string
  title: string
  contact: {
    email?: string
    phone?: string
    location?: string
    linkedin?: string
    website?: string
  }
  summary: string
  experience: Array<{
    company: string
    title: string
    location?: string
    startDate?: string
    endDate?: string
    bullets: string[]
  }>
  education: Array<{
    institution: string
    degree: string
    year?: string
  }>
  skills: string[]
  certifications?: string[]
}

export function isCvJson(v: unknown): v is CvJson {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    typeof o.title === 'string' &&
    typeof o.summary === 'string' &&
    typeof o.contact === 'object' &&
    o.contact !== null &&
    Array.isArray(o.experience) &&
    Array.isArray(o.education) &&
    Array.isArray(o.skills)
  )
}

// ATS-friendly defaults: Calibri 11pt body, plain bold headings, no columns,
// no text boxes, no tables, native Word bullets, standard section names.
const FONT = 'Calibri'
const SIZE_BODY = 22 // half-points -> 11pt
const SIZE_SMALL = 20 // 10pt
const SIZE_NAME = 36 // 18pt
const SIZE_TITLE = 24 // 12pt
const SIZE_SECTION = 24 // 12pt
const COLOR_TEXT = '000000'
const COLOR_MUTED = '555555'

function run(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string } = {}
) {
  return new TextRun({
    text,
    font: FONT,
    size: opts.size ?? SIZE_BODY,
    bold: opts.bold,
    color: opts.color ?? COLOR_TEXT,
  })
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    children: [run(text.toUpperCase(), { bold: true, size: SIZE_SECTION })],
  })
}

export function buildCvDocx(cv: CvJson, withPhoto: boolean): Document {
  const children: Paragraph[] = []

  if (withPhoto) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        border: {
          top: { style: BorderStyle.DASHED, size: 6, color: '888888' },
          bottom: { style: BorderStyle.DASHED, size: 6, color: '888888' },
          left: { style: BorderStyle.DASHED, size: 6, color: '888888' },
          right: { style: BorderStyle.DASHED, size: 6, color: '888888' },
        },
        children: [
          run('[ PHOTO — replace this box with your photo in Word ]', {
            color: '777777',
            size: SIZE_SMALL,
          }),
        ],
      })
    )
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [run(cv.name, { bold: true, size: SIZE_NAME })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [run(cv.title, { size: SIZE_TITLE, color: COLOR_MUTED })],
    })
  )

  const contactParts = [
    cv.contact.email,
    cv.contact.phone,
    cv.contact.location,
    cv.contact.linkedin,
    cv.contact.website,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)

  if (contactParts.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [run(contactParts.join(' | '), { size: SIZE_SMALL })],
      })
    )
  }

  children.push(sectionHeading('Summary'))
  children.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [run(cv.summary)],
    })
  )

  if (cv.experience.length > 0) {
    children.push(sectionHeading('Experience'))
    for (const role of cv.experience) {
      const period = [role.startDate, role.endDate].filter(Boolean).join(' – ')
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            run(role.title, { bold: true }),
            run(' — '),
            run(role.company),
          ],
        })
      )
      const meta = [role.location, period].filter(Boolean).join(' | ')
      if (meta) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [run(meta, { size: SIZE_SMALL, color: COLOR_MUTED })],
          })
        )
      }
      for (const bullet of role.bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: [run(bullet)],
          })
        )
      }
    }
  }

  if (cv.skills.length > 0) {
    children.push(sectionHeading('Skills'))
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [run(cv.skills.join(', '))],
      })
    )
  }

  if (cv.education.length > 0) {
    children.push(sectionHeading('Education'))
    for (const ed of cv.education) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            run(ed.degree, { bold: true }),
            run(' — '),
            run(ed.institution),
            ...(ed.year ? [run(` (${ed.year})`, { size: SIZE_SMALL, color: COLOR_MUTED })] : []),
          ],
        })
      )
    }
  }

  if (cv.certifications && cv.certifications.length > 0) {
    children.push(sectionHeading('Certifications'))
    for (const cert of cv.certifications) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [run(cert)],
        })
      )
    }
  }

  return new Document({
    creator: 'AI CV Radar',
    title: `${cv.name} — ${cv.title}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_BODY },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  })
}

export function buildCoverLetterDocx(params: {
  letter: string
  name: string
  contact: CvJson['contact']
}): Document {
  const { letter, name, contact } = params
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [run(name, { bold: true, size: 28 })],
    })
  )

  const contactParts = [contact.email, contact.phone, contact.location, contact.linkedin, contact.website]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (contactParts.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [run(contactParts.join(' | '), { size: SIZE_SMALL, color: COLOR_MUTED })],
      })
    )
  }

  const paragraphs = letter
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  for (const p of paragraphs) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [run(p)],
      })
    )
  }

  return new Document({
    creator: 'AI CV Radar',
    title: `${name} — Cover Letter`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_BODY },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  })
}

export function safeFilename(parts: string[]): string {
  const clean = parts
    .filter(Boolean)
    .join('_')
    .replace(/[^\w\d-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return clean || 'document'
}
