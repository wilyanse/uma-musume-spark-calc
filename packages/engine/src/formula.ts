/**
 * A tiny arithmetic parser for `rules.affinityMultiplier.formula` (01 §12), so the formula is data,
 * not code, and no `eval`/`new Function` is needed.
 *
 * Grammar (whitespace ignored):
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-' unary | atom
 *   atom   := number | 'affinity' | '(' expr ')'
 * The only variable is `affinity`. Anything else is a parse error.
 */

type Node =
  | { k: 'num'; v: number }
  | { k: 'var' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node };

export class FormulaError extends Error {
  override name = 'FormulaError';
}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`bad number at ${i} in "${src}"`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new FormulaError(`unexpected "${c}" at ${i} in "${src}"`);
    }
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Token | undefined => toks[pos];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t !== undefined && t.t === 'op' && t.v === v;
  };
  const expr = (): Node => {
    let n = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[pos++] as Token).v as '+' | '-';
      n = { k: 'bin', op, a: n, b: term() };
    }
    return n;
  };
  const term = (): Node => {
    let n = unary();
    while (isOp('*') || isOp('/')) {
      const op = (toks[pos++] as Token).v as '*' | '/';
      n = { k: 'bin', op, a: n, b: unary() };
    }
    return n;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      pos++;
      return { k: 'neg', a: unary() };
    }
    return atom();
  };
  const atom = (): Node => {
    const t = toks[pos++];
    if (t === undefined) throw new FormulaError(`unexpected end of "${src}"`);
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'id') {
      if (t.v !== 'affinity') throw new FormulaError(`unknown identifier "${t.v}" in "${src}"`);
      return { k: 'var' };
    }
    if (t.v === '(') {
      const n = expr();
      if (!isOp(')')) throw new FormulaError(`missing ")" in "${src}"`);
      pos++;
      return n;
    }
    throw new FormulaError(`unexpected "${t.v}" in "${src}"`);
  };
  const root = expr();
  if (pos !== toks.length) throw new FormulaError(`trailing input in "${src}"`);
  return root;
}

function evaluate(n: Node, affinity: number): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var':
      return affinity;
    case 'neg':
      return -evaluate(n.a, affinity);
    case 'bin': {
      const a = evaluate(n.a, affinity);
      const b = evaluate(n.b, affinity);
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      return a / b;
    }
  }
}

/** Compiles a formula in `affinity` into a function. Throws `FormulaError` on invalid input. */
export function compileAffinityFormula(src: string): (affinity: number) => number {
  const ast = parse(src);
  return (affinity) => {
    const v = evaluate(ast, affinity);
    if (!Number.isFinite(v)) {
      throw new FormulaError(`formula "${src}" is not finite at affinity=${affinity}`);
    }
    return v;
  };
}
