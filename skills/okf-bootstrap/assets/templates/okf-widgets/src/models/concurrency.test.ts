import { describe, expect, it } from 'vitest';
import { parseRequests, schedule, type Request, type Settings } from './concurrency.ts';

const flat = (n: number, ms = 100): Request[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, ms, after: [] }));
const http1 = (limit: number, setupMs = 0): Settings => ({ limit, setupMs, shared: false });

describe('schedule', () => {
  it('serialises at a limit of one, and divides the work at a higher limit', () => {
    expect(schedule(flat(6), http1(1)).totalMs).toBe(600);
    expect(schedule(flat(6), http1(2)).totalMs).toBe(300);
    expect(schedule(flat(6), http1(6)).totalMs).toBe(100);
  });

  it('stops improving once the limit exceeds the number of requests', () => {
    expect(schedule(flat(6), http1(60)).totalMs).toBe(100);
  });

  it('charges a handshake per connection opened, and not for a reused one', () => {
    const result = schedule(flat(4), http1(2, 50));
    expect(result.connections).toBe(2);
    expect(result.totalMs).toBe(50 + 100 + 100); // handshake, then two rounds on warm connections
    const bar = result.bars.find((b) => b.id === 'r2')!;
    expect(bar.sendAt).toBe(bar.start);
  });

  it('pays one handshake for a shared connection, then runs every request together', () => {
    const result = schedule(flat(6), { limit: 100, setupMs: 50, shared: true });
    expect(result.connections).toBe(1);
    expect(result.totalMs).toBe(150);
    expect(result.bars.every((b) => b.start === 50)).toBe(true);
  });

  it('cannot beat the critical path, however many connections', () => {
    const page: Request[] = [
      { id: 'html', ms: 100, after: [] },
      { id: 'css', ms: 80, after: ['html'] },
      { id: 'font', ms: 120, after: ['css'] },
      { id: 'img', ms: 60, after: ['html'] },
    ];
    const wide = schedule(page, http1(20));
    expect(wide.criticalPathMs).toBe(300);
    expect(wide.totalMs).toBe(300);
    expect(schedule(page, http1(1)).totalMs).toBe(360);
  });

  it('reports how long a ready request waited for a connection', () => {
    const bars = schedule(flat(3), http1(1)).bars;
    expect(bars.map((b) => b.queuedMs)).toEqual([0, 100, 200]);
  });

  it('rejects an unknown dependency and a cycle', () => {
    expect(() => schedule([{ id: 'a', ms: 1, after: ['nope'] }], http1(1))).toThrow(/not a request/);
    expect(() =>
      schedule(
        [
          { id: 'a', ms: 1, after: ['b'] },
          { id: 'b', ms: 1, after: ['a'] },
        ],
        http1(2),
      ),
    ).toThrow(/circular/);
  });

  it('handles no requests', () => {
    expect(schedule([], http1(3)).totalMs).toBe(0);
  });
});

describe('parseRequests', () => {
  it('reads id, duration and dependencies', () => {
    expect(parseRequests(['html 120', 'css 200 after=html', 'img 90 after=html,css'])).toEqual([
      { id: 'html', ms: 120, after: [] },
      { id: 'css', ms: 200, after: ['html'] },
      { id: 'img', ms: 90, after: ['html', 'css'] },
    ]);
  });
  it('names the bad line', () => {
    expect(() => parseRequests(['ok 10', 'bad'])).toThrow(/line 2/);
    expect(() => parseRequests(['x 0'])).toThrow(/line 1/);
  });
});
