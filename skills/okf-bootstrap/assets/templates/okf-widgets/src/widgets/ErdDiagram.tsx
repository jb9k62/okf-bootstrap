/**
 * The diagram half of the SQL ERD widget: tables as boxes, each foreign key as a line from its
 * column to the parent's key, with crow's-foot ends drawn from the constraints. It draws what
 * the layout model returns and what the widget marks; it decides nothing itself.
 */

import type { Schema } from '../models/ddl.ts';
import { BOX, type Box, layout as placeTables } from '../models/layout.ts';
import { notation, relations, type Relation } from '../models/schema.ts';

export type Mark = 'pick' | 'path' | 'delete' | 'nullify' | 'blocked' | 'good' | 'warn' | 'info';

export interface Marks {
  tables: Readonly<Record<string, Mark>>;
  /** `table.column` of the columns to flag. */
  columns: ReadonlySet<string>;
  /** Relation ids to draw heavier. */
  relations: ReadonlySet<string>;
}

const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^timestamp with time zone$/, 'timestamptz'],
  [/^timestamp without time zone$/, 'timestamp'],
  [/^character varying/, 'varchar'],
  [/^double precision$/, 'float8'],
];

function shortType(type: string): string {
  let short = type;
  for (const [pattern, replacement] of ABBREVIATIONS) short = short.replace(pattern, replacement);
  return short.length > 13 ? `${short.slice(0, 12)}…` : short;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

interface End {
  x: number;
  y: number;
  /** +1 when the line leaves the box to the right, -1 to the left. */
  dir: 1 | -1;
}

function route(relation: Relation, parent: Box, child: Box) {
  const parentY = parent.rows[relation.key.refColumns[0] ?? ''] ?? parent.y + BOX.header / 2;
  const childY = child.rows[relation.key.columns[0] ?? ''] ?? child.y + BOX.header / 2;
  let start: End;
  let end: End;
  if (parent.x + parent.width <= child.x) {
    start = { x: parent.x + parent.width, y: parentY, dir: 1 };
    end = { x: child.x, y: childY, dir: -1 };
  } else if (child.x + child.width <= parent.x) {
    start = { x: parent.x, y: parentY, dir: -1 };
    end = { x: child.x + child.width, y: childY, dir: 1 };
  } else {
    // Same column, or a table that refers to itself: loop out to the right.
    start = { x: parent.x + parent.width, y: parentY, dir: 1 };
    end = { x: child.x + child.width, y: childY, dir: 1 };
  }
  const reach = Math.max(34, Math.abs(end.x - start.x) / 2);
  const d = `M ${start.x} ${start.y} C ${start.x + start.dir * reach} ${start.y}, ${end.x + end.dir * reach} ${end.y}, ${end.x} ${end.y}`;
  return { d, parentEnd: start, childEnd: end };
}

function Glyph({ kind, end }: { kind: 'one' | 'zeroOne' | 'zeroMany'; end: End }) {
  const at = (distance: number) => end.x + end.dir * distance;
  const bar = (distance: number) => <line x1={at(distance)} y1={end.y - 5} x2={at(distance)} y2={end.y + 5} />;
  const ring = (distance: number) => <circle cx={at(distance)} cy={end.y} r={4} className="okfw-erd-ring" />;
  if (kind === 'one') return <g>{bar(9)}{bar(14)}</g>;
  if (kind === 'zeroOne') return <g>{bar(9)}{ring(17)}</g>;
  return (
    <g>
      <line x1={at(12)} y1={end.y} x2={at(0)} y2={end.y - 6} />
      <line x1={at(12)} y1={end.y} x2={at(0)} y2={end.y} />
      <line x1={at(12)} y1={end.y} x2={at(0)} y2={end.y + 6} />
      {ring(18)}
    </g>
  );
}

/** One line end, drawn as in the diagram, for the key under it. `mirrored` puts the entity on the right. */
export function KeyGlyph({ kind, mirrored = false }: { kind: 'one' | 'zeroOne' | 'zeroMany'; mirrored?: boolean }) {
  return (
    <svg className="okfw-erd-keyglyph" width={36} height={16} viewBox="0 0 36 16" aria-hidden="true">
      <g className="okfw-erd-edge" transform={mirrored ? 'translate(36,0) scale(-1,1)' : undefined}>
        <line x1={0} y1={8} x2={36} y2={8} />
        <Glyph kind={kind} end={{ x: 0, y: 8, dir: 1 }} />
      </g>
    </svg>
  );
}

export default function ErdDiagram({
  schema,
  marks,
  added,
  fit,
  expanded,
  onCollapse,
  onPick,
}: {
  schema: Schema;
  marks: Marks;
  added: ReadonlySet<string>;
  fit: boolean;
  /** Covers the window, like an expanded Mermaid diagram, so a large schema is readable. */
  expanded: boolean;
  onCollapse: () => void;
  onPick?: (table: string) => void;
}) {
  const { boxes, width, height } = placeTables(schema);
  const all = relations(schema);
  return (
    <div className="okfw-erd" data-fit={fit || expanded} data-expanded={expanded || undefined}>
      {expanded && (
        <div className="okfw-erd-topbar">
          <ul className="okfw-plain okfw-erd-key" aria-label="How to read the line ends">
            <li>
              <KeyGlyph kind="one" /> <code>||</code> exactly one <span>NOT NULL key</span>
            </li>
            <li>
              <KeyGlyph kind="zeroOne" /> <code>|o</code> <code>o|</code> zero or one{' '}
              <span>nullable or unique key</span>
            </li>
            <li>
              <KeyGlyph kind="zeroMany" mirrored /> <code>o{'{'}</code> zero or more <span>the many side</span>
            </li>
            <li className="okfw-muted">Drawn from the constraints, not by hand.</li>
          </ul>
          <button type="button" className="okfw-erd-close" onClick={onCollapse}>
            Close (Esc)
          </button>
        </div>
      )}
      <svg
        role="img"
        aria-label={`Entity relationship diagram of ${schema.tables.length} tables and ${all.length} relationships`}
        viewBox={`0 0 ${width} ${height}`}
        width={fit || expanded ? '100%' : width}
        height={fit || expanded ? undefined : height}
        style={fit && !expanded ? { aspectRatio: `${width} / ${height}` } : undefined}
      >
        {all.map((relation) => {
          const parent = boxes[relation.parent];
          const child = boxes[relation.child];
          if (!parent || !child) return null;
          const { d, parentEnd, childEnd } = route(relation, parent, child);
          return (
            <g
              key={relation.id}
              className="okfw-erd-edge"
              data-heavy={marks.relations.has(relation.id) || undefined}
            >
              <title>{`${relation.parent} ${notation(relation)} ${relation.child}`}</title>
              <path d={d} fill="none" />
              <Glyph kind={relation.mandatory ? 'one' : 'zeroOne'} end={parentEnd} />
              <Glyph kind={relation.single ? 'zeroOne' : 'zeroMany'} end={childEnd} />
            </g>
          );
        })}
        {schema.tables.map((table) => {
          const box = boxes[table.name];
          if (!box) return null;
          const mark = marks.tables[table.name];
          const foreign = new Set(table.foreignKeys.flatMap((key) => key.columns));
          return (
            <g
              key={table.name}
              className="okfw-erd-table"
              data-mark={mark}
              data-pickable={onPick ? true : undefined}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              aria-label={onPick ? `Table ${table.name}` : undefined}
              onClick={onPick && (() => onPick(table.name))}
              onKeyDown={
                onPick &&
                ((event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPick(table.name);
                  }
                })
              }
            >
              <rect className="okfw-erd-box" x={box.x} y={box.y} width={box.width} height={box.height} rx={6} />
              <path
                className="okfw-erd-head"
                d={`M ${box.x} ${box.y + BOX.header} V ${box.y + 6} a 6 6 0 0 1 6 -6 H ${box.x + box.width - 6} a 6 6 0 0 1 6 6 V ${box.y + BOX.header} Z`}
              />
              <text className="okfw-erd-title" x={box.x + 10} y={box.y + BOX.header / 2 + 4}>
                {clip(table.name, 22)}
              </text>
              {added.has(table.name) && (
                <text className="okfw-erd-new" x={box.x + box.width - 10} y={box.y + BOX.header / 2 + 3.5} textAnchor="end">
                  NEW
                </text>
              )}
              {table.columns.map((column) => {
                const y = box.rows[column.name] ?? box.y;
                const flagged = marks.columns.has(`${table.name}.${column.name}`);
                const badge = table.primaryKey.includes(column.name) ? 'PK' : foreign.has(column.name) ? 'FK' : '';
                return (
                  <g key={column.name} data-flag={flagged || undefined}>
                    {flagged && (
                      <rect className="okfw-erd-flag" x={box.x + 2} y={y - BOX.row / 2} width={box.width - 4} height={BOX.row} rx={3} />
                    )}
                    <text className="okfw-erd-badge" data-kind={badge} x={box.x + 8} y={y + 4}>
                      {badge}
                    </text>
                    <text className="okfw-erd-col" x={box.x + 30} y={y + 4}>
                      {clip(column.name, 19)}
                    </text>
                    <text className="okfw-erd-type" x={box.x + box.width - 8} y={y + 4} textAnchor="end">
                      {shortType(column.type)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
