// lib/server/keith/outputSchema.js
//
// KEITH-FOUNDATION-1: the JSON Schema subset a Skill's output is checked against, with no new
// dependency. It covers what Skill outputs use: type (one or a list), enum, const, required,
// properties, additionalProperties (false or a schema), items, minItems/maxItems,
// minLength/maxLength, minimum/maximum, pattern. Anything else in a schema is ignored, never
// silently treated as a pass for something it did not check: see SUPPORTED.
//
// validate(schema, value) returns [] when the value fits, or a list of "path: problem" strings.
// The runner logs the list and drops the output; it is never shown to anyone.

export const SUPPORTED = Object.freeze([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern',
  'description', 'title', '$comment',
])

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const fits = (want, v) => {
  const t = typeOf(v)
  return want === t || (want === 'number' && (t === 'integer' || t === 'number'))
}

export function validate(schema, value, path = '$', out = []) {
  if (!schema || typeof schema !== 'object') return out
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => fits(t, value))) { out.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`); return out }
  }
  if ('const' in schema && value !== schema.const) out.push(`${path}: must be ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.push(`${path}: not one of ${schema.enum.join(', ')}`)
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`)
    if (schema.maxLength != null && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`)
    if (schema.maximum != null && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.maxItems != null && value.length > schema.maxItems) out.push(`${path}: more than ${schema.maxItems} items`)
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, `${path}[${i}]`, out))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${path}.${k}: required`)
    const props = schema.properties || {}
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validate(props[k], v, `${path}.${k}`, out)
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: not allowed`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, `${path}.${k}`, out)
    }
  }
  return out
}

/** A schema that uses a keyword this validator does not check is a programming error, caught in tests. */
export function unsupportedKeywords(schema, path = '$', out = []) {
  if (!schema || typeof schema !== 'object') return out
  for (const k of Object.keys(schema)) if (!SUPPORTED.includes(k)) out.push(`${path}.${k}`)
  for (const [k, v] of Object.entries(schema.properties || {})) unsupportedKeywords(v, `${path}.${k}`, out)
  if (schema.items) unsupportedKeywords(schema.items, `${path}[]`, out)
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') unsupportedKeywords(schema.additionalProperties, `${path}.*`, out)
  return out
}

/** The first JSON object or array in a completion, tolerating a ```json fence around it. */
export function jsonFromText(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = s.search(/[[{]/)
  const fail = (code) => Object.assign(new Error(code === 'no_json' ? 'no JSON in the completion' : 'the JSON in the completion does not parse'), { code })
  if (start < 0) throw fail('no_json')
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  const end = s.lastIndexOf(close)
  if (end <= start) throw fail('no_json')
  try { return JSON.parse(s.slice(start, end + 1)) } catch { throw fail('bad_json') }
}
