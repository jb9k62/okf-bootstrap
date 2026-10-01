/**
 * CSS selector specificity and the cascade that uses it. The css-specificity widget draws this;
 * specificity.test.ts pins it with the examples from the Selectors and Cascade specs.
 *
 * A selector's specificity is three counts, compared left to right: ids, then classes /
 * attributes / pseudo-classes, then element types / pseudo-elements. `*`, combinators and
 * `:where()` add nothing; `:is()`, `:not()` and `:has()` count as their most specific argument.
 */

export type Specificity = readonly [ids: number, classes: number, types: number];
export type PartKind = 'id' | 'class' | 'type' | 'zero';

/** A piece of the selector text and the column it counts in (`zero` counts nowhere). */
export interface Part {
  text: string;
  kind: PartKind;
}

export interface Parsed {
  specificity: Specificity;
  parts: Part[];
}

const IDENT = /^(?:[\w-]|[^\x00-\x7f]|\\.)+/;

const compare = (a: Specificity, b: Specificity): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const add = (a: Specificity, b: Specificity): Specificity => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

const ZERO: Specificity = [0, 0, 0];

/** Index just past the `)` that closes the `(` at `open`. */
function closeParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced parenthesis');
}

/** Split on commas that are not inside brackets or parentheses. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const maxOf = (selectors: string[]): Specificity =>
  selectors.reduce<Specificity>((best, s) => {
    const next = parseSelector(s).specificity;
    return compare(next, best) > 0 ? next : best;
  }, ZERO);

const LEGACY_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/**
 * Specificity of one complex selector, with the pieces that made it. Throws on a top-level
 * comma (a selector list is several selectors, each with its own specificity) or on text it
 * cannot read, so the widget can say so instead of showing a wrong number.
 */
export function parseSelector(selector: string): Parsed {
  const text = selector.trim();
  if (text === '') throw new Error('empty selector');
  if (splitTop(text).length > 1) {
    throw new Error('a selector list has one specificity per selector; give one at a time');
  }
  let total: Specificity = ZERO;
  const parts: Part[] = [];
  const push = (piece: string, kind: PartKind, by: Specificity) => {
    parts.push({ text: piece, kind });
    total = add(total, by);
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i]!;
    if (ch === '#' || ch === '.') {
      const id = IDENT.exec(rest.slice(1));
      if (!id) throw new Error(`expected a name after "${ch}"`);
      const piece = ch + id[0];
      push(piece, ch === '#' ? 'id' : 'class', ch === '#' ? [1, 0, 0] : [0, 1, 0]);
      i += piece.length;
    } else if (ch === '[') {
      let j = i + 1;
      let quote = '';
      while (j < text.length && (quote || text[j] !== ']')) {
        if (text[j] === '\\') j++;
        else if (quote) quote = text[j] === quote ? '' : quote;
        else if (text[j] === '"' || text[j] === "'") quote = text[j]!;
        j++;
      }
      if (j >= text.length) throw new Error('unclosed [');
      push(text.slice(i, j + 1), 'class', [0, 1, 0]);
      i = j + 1;
    } else if (ch === ':') {
      const element = text[i + 1] === ':';
      const name = IDENT.exec(rest.slice(element ? 2 : 1));
      if (!name) throw new Error('expected a name after ":"');
      const head = (element ? '::' : ':') + name[0];
      const lower = name[0].toLowerCase();
      let end = i + head.length;
      let args: string | null = null;
      if (text[end] === '(') {
        const close = closeParen(text, end);
        args = text.slice(end + 1, close - 1);
        end = close;
      }
      const piece = text.slice(i, end);
      if (element || LEGACY_ELEMENTS.has(lower)) push(piece, 'type', [0, 0, 1]);
      else if (lower === 'where') push(piece, 'zero', ZERO);
      else if (args !== null && ['is', 'not', 'matches', 'has'].includes(lower)) {
        push(piece, 'class', maxOf(splitTop(args)));
      } else if (args !== null && /^nth-(last-)?(child|of-type)$/.test(lower)) {
        // :nth-child(2n+1 of .x) counts itself as a class plus its most specific "of" argument.
        const of = / of /.exec(args);
        push(piece, 'class', add([0, 1, 0], of ? maxOf(splitTop(args.slice(of.index + 4))) : ZERO));
      } else push(piece, 'class', [0, 1, 0]);
      i = end;
    } else if (ch === '*') {
      push('*', 'zero', ZERO);
      i++;
    } else if (/\s|[>+~]/.test(ch)) {
      const gap = /^\s*[>+~]?\s*/.exec(rest)![0];
      push(gap.trim() === '' ? ' ' : gap.trim(), 'zero', ZERO);
      i += gap.length;
    } else if (ch === '|') {
      push('|', 'zero', ZERO);
      i++;
    } else {
      const name = IDENT.exec(rest);
      if (!name) throw new Error(`unexpected "${ch}"`);
      push(name[0], 'type', [0, 0, 1]);
      i += name[0].length;
    }
  }
  return { specificity: total, parts };
}

export const formatSpecificity = (s: Specificity): string => `(${s.join(', ')})`;

/** One declaration that competes for the same property on the same element. */
export interface Declaration {
  id: string;
  selector: string;
  value: string;
  important?: boolean;
  /** A `style="..."` attribute on the element rather than a rule. Its selector is ignored. */
  inline?: boolean;
  /** `@layer` rank, later layers higher. Null or absent: not in a layer. */
  layer?: number | null;
}

export type Reason = 'important' | 'inline' | 'layer' | 'specificity' | 'order';

export interface Ranked {
  declaration: Declaration;
  specificity: Specificity;
  parts: Part[];
  /** Position in the stylesheet, 0-based: later wins a tie. */
  order: number;
  /** Why this one lost to the winner (null for the winner). */
  lostOn: Reason | null;
}

/** The declaration's layer as a number where bigger means stronger for this importance. */
function layerStrength(d: Declaration): number {
  const rank = d.layer ?? Infinity; // unlayered rules sit after every layer
  return d.important ? -rank : rank; // !important reverses the layer order
}

/** Which step of the cascade decides between `a` and `b`, and in whose favour (>0: a wins). */
function decide(a: Ranked, b: Ranked): { sign: number; on: Reason } {
  const steps: [Reason, number][] = [
    ['important', Number(Boolean(a.declaration.important)) - Number(Boolean(b.declaration.important))],
    ['inline', Number(Boolean(a.declaration.inline)) - Number(Boolean(b.declaration.inline))],
    ['layer', layerStrength(a.declaration) - layerStrength(b.declaration) || 0],
    ['specificity', compare(a.specificity, b.specificity)],
    ['order', a.order - b.order],
  ];
  for (const [on, diff] of steps) if (diff !== 0) return { sign: Math.sign(diff), on };
  return { sign: 0, on: 'order' };
}

/**
 * Resolve the cascade for one property on one element. Returns every declaration strongest
 * first, each loser tagged with the step of the cascade at which it lost to the winner.
 * Order in the input is stylesheet order. Throws if any selector cannot be read.
 */
export function cascade(declarations: readonly Declaration[]): Ranked[] {
  const ranked: Ranked[] = declarations.map((declaration, order) => {
    const parsed = declaration.inline
      ? { specificity: ZERO, parts: [] as Part[] }
      : parseSelector(declaration.selector);
    return { declaration, specificity: parsed.specificity, parts: parsed.parts, order, lostOn: null };
  });
  ranked.sort((a, b) => -decide(a, b).sign);
  const winner = ranked[0];
  if (!winner) return [];
  for (const other of ranked.slice(1)) other.lostOn = decide(winner, other).on;
  return ranked;
}
