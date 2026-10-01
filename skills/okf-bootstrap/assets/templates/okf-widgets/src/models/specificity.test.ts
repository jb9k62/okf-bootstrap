import { describe, expect, it } from 'vitest';
import { cascade, parseSelector, type Declaration } from './specificity.ts';

const spec = (selector: string) => parseSelector(selector).specificity;

// The examples from the Selectors Level 4 specification (section 17).
describe('parseSelector', () => {
  it.each([
    ['*', [0, 0, 0]],
    ['li', [0, 0, 1]],
    ['ul li', [0, 0, 2]],
    ['ul ol+li', [0, 0, 3]],
    ['ul ol li.red', [0, 1, 3]],
    ['li.red.level', [0, 2, 1]],
    ['#x34y', [1, 0, 0]],
    ['h1 + *[rel=up]', [0, 1, 1]],
    ['#s12:not(p)', [1, 0, 1]],
    ['a:not(#id, .c)', [1, 0, 1]],
    ['li > a[href="x]y"]', [0, 1, 2]],
    ['p::first-line', [0, 0, 2]],
    ['p:first-line', [0, 0, 2]],
    ['a:hover', [0, 1, 1]],
    ['div:where(#a, .b) p', [0, 0, 2]],
    ['li:is(.a, #b) a', [1, 0, 2]],
    ['li:nth-child(2n + 1)', [0, 1, 1]],
    ['li:nth-child(2n + 1 of .x, #y)', [1, 1, 1]],
  ])('%s is %j', (selector, expected) => {
    expect(spec(selector)).toEqual(expected);
  });

  it('names the column each part counts in', () => {
    expect(parseSelector('ul > li.red').parts).toEqual([
      { text: 'ul', kind: 'type' },
      { text: '>', kind: 'zero' },
      { text: 'li', kind: 'type' },
      { text: '.red', kind: 'class' },
    ]);
  });

  it('refuses a selector list, an empty selector and unbalanced input', () => {
    expect(() => parseSelector('a, b')).toThrow(/one at a time/);
    expect(() => parseSelector('  ')).toThrow(/empty/);
    expect(() => parseSelector('a:not(.b')).toThrow(/unbalanced/);
    expect(() => parseSelector('a[href')).toThrow(/unclosed/);
    expect(() => parseSelector('.')).toThrow(/name/);
  });

  it('counts ten classes as less than one id: columns do not carry', () => {
    expect(spec('.a.b.c.d.e.f.g.h.i.j')).toEqual([0, 10, 0]);
    const [winner] = cascade([
      { id: 'ids', selector: '#x', value: 'blue' },
      { id: 'classes', selector: '.a.b.c.d.e.f.g.h.i.j', value: 'red' },
    ]);
    expect(winner!.declaration.id).toBe('ids');
  });
});

const d = (id: string, selector: string, extra: Partial<Declaration> = {}): Declaration => ({
  id,
  selector,
  value: id,
  ...extra,
});

describe('cascade', () => {
  it('prefers higher specificity, then the later rule', () => {
    const ranked = cascade([d('a', '.x'), d('b', 'p.x'), d('c', 'p.x')]);
    expect(ranked.map((r) => r.declaration.id)).toEqual(['c', 'b', 'a']);
    expect(ranked[1]!.lostOn).toBe('order');
    expect(ranked[2]!.lostOn).toBe('specificity');
  });

  it('lets !important beat an id and inline style, and inline beat an id', () => {
    const ranked = cascade([
      d('id', '#a'),
      d('inline', '', { inline: true }),
      d('bang', 'p', { important: true }),
    ]);
    expect(ranked.map((r) => r.declaration.id)).toEqual(['bang', 'inline', 'id']);
    expect(ranked[1]!.lostOn).toBe('important');
    expect(ranked[2]!.lostOn).toBe('important');
  });

  it('puts unlayered rules above layers, and reverses that for !important', () => {
    const normal = cascade([d('layered', '#a', { layer: 1 }), d('plain', 'p')]);
    expect(normal[0]!.declaration.id).toBe('plain');
    expect(normal[1]!.lostOn).toBe('layer');
    const bang = cascade([
      d('layered', 'p', { layer: 0, important: true }),
      d('plain', '#a', { important: true }),
    ]);
    expect(bang[0]!.declaration.id).toBe('layered');
  });

  it('ranks a later layer above an earlier one whatever the specificity', () => {
    const [winner] = cascade([d('early', '#a', { layer: 0 }), d('late', 'p', { layer: 1 })]);
    expect(winner!.declaration.id).toBe('late');
  });

  it('handles no declarations', () => {
    expect(cascade([])).toEqual([]);
  });
});
