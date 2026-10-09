// Pulls the JSON object/array out of a model response (models sometimes wrap
// it in prose or code fences) and parses it. Throws when there is none; the
// result is untrusted and must still be validated with a schema.
export function extractJson(text: string, kind: 'object' | 'array'): unknown {
  const match = text.match(kind === 'object' ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/)
  if (!match) throw new Error(`No JSON ${kind} found in response`)
  return JSON.parse(match[0])
}
