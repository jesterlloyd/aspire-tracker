// src/lib/sheet/sheetFormula.js
//
// SHEET-FORMULA-1 (Owner, 2026-09-27: "is it possible to allow formulas? like typing = sign
// brings them out? even the simple ones will do"). A cell that takes a number may be typed as a
// formula: "=" then arithmetic (+ - * / ^, brackets, a trailing % for a percent), the functions
// SUM, AVERAGE, MIN, MAX, ROUND, ABS, and references to other cells IN THE SAME ROW by column
// name in square brackets, the way Smartsheet writes them: =[Qty]*12.50, =ROUND([Spent ($)]/3, 2).
//
// A formula works across its own row. A whole column's total is the summary row's job (Σ), and a
// reference to another row would break the moment the grid is sorted, so neither is offered.
//
// This is a parser, never eval: an unknown word, a stray character or a reference to a column that
// is not in the row is an error with a sentence, and nothing typed can run as code. Pure: no DOM.

export const FORMULA_MAX = 500
export const FORMULA_FUNCTIONS = Object.freeze(['SUM', 'AVERAGE', 'MIN', 'MAX', 'ROUND', 'ABS'])

export const isFormula = (text) => typeof text === 'string' && /^\s*=/.test(text)

export class FormulaError extends Error {}

/** The column names a formula reads, in the order written (duplicates removed). */
export function formulaRefs(text) {
  const out = []
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]/g)) { const n = m[1].trim(); if (!out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n) }
  return out
}

function tokenize(src) {
  const toks = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i))
      if (!m) throw new FormulaError(`"${ch}" is not a number.`)
      toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length
      if (src[i] === ',' && /^\d{3}(?!\d)/.test(src.slice(i + 1))) throw new FormulaError('Leave the thousands comma out of a number in a formula (1000, not 1,000).')
      continue
    }
    if (ch === '$') { i++; continue }   // "=$12.50*2" reads as money
    if (ch === '[') {
      const end = src.indexOf(']', i)
      if (end < 0) throw new FormulaError('A column name starts with [ and ends with ].')
      toks.push({ t: 'ref', v: src.slice(i + 1, end).trim() }); i = end + 1; continue
    }
    if (/[A-Za-z]/.test(ch)) {
      const m = /^[A-Za-z]+/.exec(src.slice(i))
      toks.push({ t: 'fn', v: m[0].toUpperCase() }); i += m[0].length; continue
    }
    if ('+-*/^(),%'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue }
    throw new FormulaError(`"${ch}" cannot be used in a formula.`)
  }
  return toks
}

/**
 * Evaluate a formula. `refOf(name)` returns the referenced cell's number (null or '' for a blank,
 * which counts as 0, as a spreadsheet counts it) or undefined when the row has no such column.
 * Returns the number, rounded to 10 decimal places so 0.1 + 0.2 is 0.3.
 */
export function evaluateFormula(text, refOf = () => undefined) {
  const src = String(text || '').replace(/^\s*=/, '')
  if (!src.trim()) throw new FormulaError('Type a calculation after the = sign.')
  if (src.length > FORMULA_MAX) throw new FormulaError('This formula is too long.')
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v) => peek()?.t === 'op' && peek().v === v
  const take = (v) => { if (!isOp(v)) throw new FormulaError(v === ')' ? 'A bracket is not closed.' : `Expected "${v}".`); p++ }

  const ref = (name) => {
    const v = refOf(name)
    if (v === undefined) throw new FormulaError(`There is no column named [${name}] in this row.`)
    if (v === null || v === '') return 0
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
    if (!Number.isFinite(n)) throw new FormulaError(`[${name}] is not a number.`)
    return n
  }
  const call = (name, args) => {
    if (!FORMULA_FUNCTIONS.includes(name)) throw new FormulaError(`${name} is not a function this sheet knows. Use ${FORMULA_FUNCTIONS.join(', ')}.`)
    if (name === 'ROUND') {
      if (args.length < 1 || args.length > 2) throw new FormulaError('ROUND takes a number and, if you like, the decimal places: ROUND(12.345, 2).')
      const d = Math.max(0, Math.min(10, Math.trunc(args[1] ?? 0))), k = 10 ** d
      return Math.round((args[0] + Number.EPSILON * Math.sign(args[0])) * k) / k
    }
    if (name === 'ABS') { if (args.length !== 1) throw new FormulaError('ABS takes one number.'); return Math.abs(args[0]) }
    if (!args.length) throw new FormulaError(`${name} needs at least one number.`)
    if (name === 'SUM') return args.reduce((a, b) => a + b, 0)
    if (name === 'AVERAGE') return args.reduce((a, b) => a + b, 0) / args.length
    return name === 'MIN' ? Math.min(...args) : Math.max(...args)
  }
  const primary = () => {
    const tk = peek()
    if (!tk) throw new FormulaError('The formula ends too soon.')
    if (tk.t === 'num') { p++; return tk.v }
    if (tk.t === 'ref') { p++; return ref(tk.v) }
    if (tk.t === 'fn') {
      p++
      if (!isOp('(')) throw new FormulaError(`"${tk.v}" is not a function or a number. Put a column name in brackets: [${tk.v}].`)
      p++
      const args = []
      if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()) } }
      take(')')
      return call(tk.v, args)
    }
    if (isOp('(')) { p++; const v = expr(); take(')'); return v }
    throw new FormulaError(`"${tk.v}" is out of place.`)
  }
  const postfix = () => { let v = primary(); while (isOp('%')) { p++; v /= 100 } return v }
  const unary = () => {
    if (isOp('-')) { p++; return -unary() }
    if (isOp('+')) { p++; return unary() }
    return postfix()
  }
  const power = () => { const b = unary(); if (isOp('^')) { p++; return b ** power() } return b }   // right-associative
  const term = () => {
    let v = power()
    while (isOp('*') || isOp('/')) {
      const op = peek().v; p++
      const r = power()
      if (op === '/' && r === 0) throw new FormulaError('This divides by zero.')
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function expr() {
    let v = term()
    while (isOp('+') || isOp('-')) { const op = peek().v; p++; const r = term(); v = op === '+' ? v + r : v - r }
    return v
  }
  const v = expr()
  if (p < toks.length) throw new FormulaError(`"${toks[p].v}" is out of place.`)
  if (!Number.isFinite(v)) throw new FormulaError('The result is not a number.')
  return Math.round(v * 1e10) / 1e10
}

/** A formula's result, or its error sentence: { value } | { error }. */
export function tryFormula(text, refOf) {
  try { return { value: evaluateFormula(text, refOf) } }
  catch (e) { if (e instanceof FormulaError) return { error: e.message }; throw e }
}
