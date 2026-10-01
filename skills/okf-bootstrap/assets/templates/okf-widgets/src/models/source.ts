/**
 * Reading the text a concept puts under a widget's name. Widgets that take data (`sql-erd`'s
 * schema, `http-concurrency`'s requests, `css-specificity`'s rules) share one convention so an
 * author learns it once: one record per line, blank lines ignored, and `--` starts a comment
 * (the same marker SQL uses, and one that CSS selectors and numbers never begin with).
 */

/** The meaningful lines of `source`: trimmed, with blanks and `--` comments removed. */
export function dataLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('--'));
}

/** Split `a | b | c` into trimmed cells. */
export function cells(line: string): string[] {
  return line.split('|').map((cell) => cell.trim());
}

/** A line that could not be read, with its 1-based position among the data lines. */
export class SourceError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}
