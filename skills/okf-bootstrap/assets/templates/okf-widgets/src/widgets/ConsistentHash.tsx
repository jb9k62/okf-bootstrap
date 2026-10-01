/**
 * Micro-world: keys spread across servers. The reader sees where `hash % servers` sends a key
 * and where a hash ring does, then adds a server. Modulo hashing reshuffles nearly everything
 * (every cache entry is suddenly on the wrong server); the ring moves only the keys the new
 * server takes over. Virtual nodes are the second lesson: one point per server is uneven.
 */

import { Facts, ModelNote, Note, Presets, Slider, useWorld, type WorldPreset } from '../kit.tsx';
import { buildRing, place, RING_SIZE } from '../models/ring.ts';

const KEYS = 2000;

interface State {
  nodes: number;
  vnodes: number;
}

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'one',
    label: 'One point per server',
    state: { nodes: 8, vnodes: 1 },
    note: 'With one point each, the arcs between points are very uneven, so one server owns far more than its share. Compare the bars: the busiest server carries a multiple of the average.',
  },
  {
    id: 'many',
    label: '128 virtual nodes each',
    state: { nodes: 8, vnodes: 128 },
    note: 'Each server is placed at many points, so its share is the sum of many small arcs and evens out. The cost is a bigger ring to store and search.',
  },
  {
    id: 'big',
    label: 'Twenty servers',
    state: { nodes: 20, vnodes: 64 },
    note: 'The more servers there are, the smaller the slice a new one takes: on a ring about 1 key in 21 moves, while modulo still moves nearly all of them.',
  },
];

const colour = (node: number) => `hsl(${(node * 137.5) % 360}, 65%, 50%)`;
const percent = (n: number) => `${Math.round(n * 100)}%`;

export default function ConsistentHash() {
  const world = useWorld(PRESETS);
  const { nodes, vnodes } = world.state;
  const ring = buildRing(nodes, vnodes);
  const placement = place(nodes, vnodes, KEYS);
  const peak = Math.max(...placement.load);
  const R = 90;

  return (
    <div>
      <Presets presets={PRESETS} active={world.preset?.id ?? null} probe="many" onChoose={world.choose} />
      <div className="okfw-columns">
        <section>
          <Slider label="Servers" value={nodes} min={2} max={20} onChange={(next) => world.set({ nodes: next })} />
          <Slider label="Virtual nodes per server" value={vnodes} min={1} max={256} onChange={(next) => world.set({ vnodes: next })} />
          <p className="okfw-reason">{KEYS} keys, hashed onto a ring of 2^32 positions.</p>
        </section>
        <section>
          <svg className="okfw-ring" viewBox="-110 -110 220 220" role="img" aria-label={`A hash ring with ${ring.length} points for ${nodes} servers`}>
            <circle r={R} fill="none" stroke="var(--border-strong, #cbd5e1)" strokeWidth="1" />
            {ring.map((point, i) => {
              const angle = (point.at / RING_SIZE) * 2 * Math.PI - Math.PI / 2;
              return <circle key={i} cx={R * Math.cos(angle)} cy={R * Math.sin(angle)} r={ring.length > 200 ? 2 : 4} fill={colour(point.node)} />;
            })}
          </svg>
        </section>
      </div>

      <h4>Keys per server</h4>
      <div className="okfw-loads" role="img" aria-label="Keys per server">
        {placement.load.map((count, node) => (
          <span key={node} style={{ height: `${peak ? (count / peak) * 100 : 0}%`, background: colour(node) }} title={`server ${node + 1}: ${count} keys`} />
        ))}
      </div>

      <Facts
        testId="ring-result"
        rows={[
          [
            'Busiest server',
            <>
              <strong className="okfw-big" data-bad={placement.imbalance > 1.5}>
                {placement.imbalance.toFixed(2)}x
              </strong>{' '}
              the average
            </>,
          ],
          [`Add server ${nodes + 1}: keys moved, hash ring`, percent(placement.movedRing)],
          [`Add server ${nodes + 1}: keys moved, hash % servers`, <strong key="m">{percent(placement.movedModulo)}</strong>],
        ]}
      />
      {placement.imbalance > 1.5 && (
        <Note tone="warn">One server holds {placement.imbalance.toFixed(1)}x its fair share: add virtual nodes.</Note>
      )}
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/ring.ts</code>. A "moved" key is one whose owner differs after the
        extra server joins; in a cache that is a miss, in a database it is data to copy.
      </ModelNote>
    </div>
  );
}
