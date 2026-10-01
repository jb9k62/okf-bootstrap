import { describe, expect, it } from 'vitest';
import { cells, dataLines, SourceError } from './source.ts';

describe('dataLines', () => {
  it('drops blanks and -- comments, and trims', () => {
    expect(dataLines('  a | b  \n\n-- note\n  c  \n')).toEqual(['a | b', 'c']);
  });
  it('keeps a CSS id selector, which starts with # not --', () => {
    expect(dataLines('#id | red')).toEqual(['#id | red']);
  });
});

describe('cells', () => {
  it('splits and trims', () => {
    expect(cells(' a.b |red|  !important ')).toEqual(['a.b', 'red', '!important']);
  });
});

describe('SourceError', () => {
  it('names the line', () => {
    expect(new SourceError(3, 'bad').message).toBe('line 3: bad');
  });
});
