/**
 * A client fetching a set of requests through a limited number of connections. The
 * http-concurrency widget draws this; concurrency.test.ts pins it.
 *
 * Two ceilings decide how long it takes, and the model reports both: the work divided across the
 * connections, and the critical path (the longest chain of requests that each wait for the one
 * before). Past the second, more connections change nothing.
 */

export interface Request {
  id: string;
  /** Time on the wire once started, in ms. */
  ms: number;
  /** Requests that must finish before this one can start (a script found in the HTML). */
  after: string[];
}

export interface Settings {
  /** Requests in flight at once: connections for HTTP/1.1, streams for HTTP/2. */
  limit: number;
  /** Cost of opening a connection (TCP + TLS handshakes), in ms. */
  setupMs: number;
  /** One connection carries every request (HTTP/2): the handshake is paid once, up front. */
  shared: boolean;
}

export interface Bar {
  id: string;
  /** The connection (or stream) that carried it, 0-based. */
  lane: number;
  /** When the request was ready and the wait for a free connection ended. */
  start: number;
  /** When the handshake finished and bytes began: equals `start` on a reused connection. */
  sendAt: number;
  end: number;
  /** How long it sat ready with no connection free. */
  queuedMs: number;
}

export interface Schedule {
  bars: Bar[];
  totalMs: number;
  /** Sum of every request's `ms`. */
  workMs: number;
  /** Longest dependency chain, handshake excluded: nothing finishes sooner whatever the limit. */
  criticalPathMs: number;
  /** Connections that were actually opened. */
  connections: number;
}

/**
 * Run `requests` in order of readiness. A request starts as soon as its `after` set has
 * finished and a connection is free; a connection that has served a request is reused for
 * free (keep-alive), a fresh one pays `setupMs`. Throws on an unknown or circular dependency.
 */
export function schedule(requests: readonly Request[], settings: Settings): Schedule {
  const limit = Math.max(1, Math.floor(settings.limit));
  const byId = new Map(requests.map((r) => [r.id, r]));
  for (const r of requests) {
    for (const dep of r.after) {
      if (!byId.has(dep)) throw new Error(`${r.id} waits for ${dep}, which is not a request`);
    }
  }

  const finishedAt = new Map<string, number>();
  const laneFree: number[] = Array.from({ length: limit }, () => 0);
  const opened = new Set<number>();
  const readyAt = new Map<string, number>();
  const pending = [...requests];
  const bars: Bar[] = [];
  let now = 0;

  // A shared connection is opened once, and every request waits for it.
  const handshake = settings.shared && settings.setupMs > 0 ? settings.setupMs : 0;

  while (pending.length > 0) {
    let started = false;
    for (let i = 0; i < pending.length; i++) {
      const req = pending[i]!;
      const deps = req.after.map((d) => finishedAt.get(d));
      if (deps.some((d) => d === undefined || d > now)) continue;
      const ready = Math.max(0, ...(deps as number[]));
      if (!readyAt.has(req.id)) readyAt.set(req.id, ready);
      // A free lane that already has a connection beats opening a new one.
      let lane = -1;
      for (let l = 0; l < limit; l++) {
        if (laneFree[l]! > now) continue;
        if (lane === -1 || (opened.has(l) && !opened.has(lane))) lane = l;
        if (opened.has(l)) break;
      }
      if (lane === -1 || now < handshake) continue;
      const fresh = !opened.has(lane) && !settings.shared;
      opened.add(lane);
      const sendAt = now + (fresh ? settings.setupMs : 0);
      const end = sendAt + req.ms;
      laneFree[lane] = end;
      finishedAt.set(req.id, end);
      bars.push({
        id: req.id,
        lane,
        start: now,
        sendAt,
        end,
        queuedMs: now - Math.max(ready, handshake),
      });
      pending.splice(i, 1);
      i--;
      started = true;
    }
    if (pending.length === 0) break;
    // Jump to the next moment anything changes: a connection frees, or a dependency finishes.
    const later = [...laneFree, ...finishedAt.values(), handshake].filter((t) => t > now);
    if (later.length === 0 && !started) {
      throw new Error(`circular dependency among ${pending.map((r) => r.id).join(', ')}`);
    }
    if (later.length > 0) now = Math.min(...later);
  }

  const chain = new Map<string, number>();
  const longest = (id: string): number => {
    const known = chain.get(id);
    if (known !== undefined) return known;
    const r = byId.get(id)!;
    const value = r.ms + Math.max(0, ...r.after.map(longest));
    chain.set(id, value);
    return value;
  };

  return {
    bars,
    totalMs: Math.max(0, ...bars.map((b) => b.end)),
    workMs: requests.reduce((sum, r) => sum + r.ms, 0),
    criticalPathMs: Math.max(0, ...requests.map((r) => longest(r.id))),
    connections: settings.shared ? Math.min(1, bars.length) : opened.size,
  };
}

/**
 * Read one request per line: `id ms [after=a,b]`. Throws with the line number on a bad line.
 * (The caller supplies data lines already stripped of comments; see source.ts.)
 */
export function parseRequests(lines: readonly string[]): Request[] {
  return lines.map((line, index) => {
    const [id, ms, ...rest] = line.split(/\s+/);
    const number = Number(ms);
    if (!id || !Number.isFinite(number) || number <= 0) {
      throw new Error(`line ${index + 1}: expected "id ms [after=a,b]", got "${line}"`);
    }
    const after = rest
      .filter((word) => word.startsWith('after='))
      .flatMap((word) => word.slice(6).split(',').filter(Boolean));
    return { id, ms: number, after };
  });
}
