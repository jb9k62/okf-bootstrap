/**
 * A micro-world for a relational schema, written as the SQL it really is. Paste CREATE TABLE
 * statements into the concept's ```widget block (after the name) and the reader gets:
 *   - scenarios (a small schema, then the same business grown large), each a `-- scenario:` part
 *   - the diagram, with crow's-foot ends derived from NOT NULL and UNIQUE rather than drawn by hand
 *   - a design review: what is well designed and what is not, with the theory behind each check
 *   - the join path between two tables, written as SQL, with a warning where rows multiply
 *   - the delete impact of a row: what cascades, what is nulled and what is refused
 *   - two safeguards to switch off (foreign keys, indexes), and the SQL to edit live
 *
 * The anatomy follows the other widgets: presets, free controls, everything derived from the
 * inputs on every render, one data-probe control, and a line saying what is a model.
 */

import { useEffect, useMemo, useState } from 'react';
import { Facts, ModelNote, Note, Presets } from '../kit.tsx';
import { parseDdl, parseScenarios } from '../models/ddl.ts';
import {
  deleteImpact,
  joinPath,
  notation,
  relations,
  review,
  score,
  withSafeguards,
  type Finding,
  type Safeguards,
} from '../models/schema.ts';
import ErdDiagram, { KeyGlyph, type Mark, type Marks } from './ErdDiagram.tsx';

/** What a block with no SQL shows, so a bare ```widget sql-erd``` still works. */
const SAMPLE = `-- scenario: Sample | Three tables: replace this by writing SQL under the widget name
CREATE TABLE carrier (id text PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE parcel (
  id uuid PRIMARY KEY,
  carrier_id text NOT NULL REFERENCES carrier (id),
  tracking_number text NOT NULL,
  UNIQUE (carrier_id, tracking_number)
);
CREATE TABLE tracking_event (
  id uuid PRIMARY KEY,
  parcel_id uuid NOT NULL REFERENCES parcel (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX tracking_event_parcel ON tracking_event (parcel_id, occurred_at);`;

type Mode = 'review' | 'join' | 'delete' | 'sql';
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'review', label: 'Design review' },
  { id: 'join', label: 'Join path' },
  { id: 'delete', label: 'Delete impact' },
  { id: 'sql', label: 'Edit the SQL' },
];

const ICON = { good: '✓', warn: '!', info: 'i' } as const;

const EFFECT_TEXT = {
  delete: 'is deleted too',
  nullify: 'keeps the row, with the column reset',
  blocked: 'refuses the delete while any row points at it',
} as const;

export default function SqlErd({ source }: { source: string }) {
  const scenarios = useMemo(() => parseScenarios(source.trim() ? source : SAMPLE), [source]);
  const [scenarioId, setScenarioId] = useState(scenarios[0]!.id);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [safeguards, setSafeguards] = useState<Safeguards>({ foreignKeys: true, indexes: true });
  const [mode, setMode] = useState<Mode>('review');
  const [fit, setFit] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [join, setJoin] = useState<{ from: string | null; to: string | null; next: 'from' | 'to' }>({
    from: null,
    to: null,
    next: 'from',
  });
  const [victim, setVictim] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setExpanded(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [expanded]);

  const scenario = scenarios.find((candidate) => candidate.id === scenarioId) ?? scenarios[0]!;
  const sql = edits[scenario.id] ?? scenario.sql;
  const parsed = useMemo(() => parseDdl(sql), [sql]);
  const schema = useMemo(() => withSafeguards(parsed, safeguards), [parsed, safeguards]);
  const names = schema.tables.map((table) => table.name);

  // What the first scenario already had, so a larger one can show what it adds.
  const baseline = useMemo(
    () => new Set(parseDdl(scenarios[0]!.sql).tables.map((table) => table.name)),
    [scenarios],
  );
  const added = new Set(scenario.id === scenarios[0]!.id ? [] : names.filter((name) => !baseline.has(name)));

  const findings = useMemo(() => review(schema), [schema]);
  const health = score(findings);
  const finding: Finding | undefined =
    findings.find((candidate) => candidate.id === findingId) ??
    findings.find((candidate) => candidate.level === 'warn') ??
    findings[0];

  const pick = (chosen: string | null, fallback: string | undefined) =>
    chosen && names.includes(chosen) ? chosen : fallback;
  const from = pick(join.from, names[0]);
  const to = pick(join.to, names[names.length - 1]);
  const path = from && to ? joinPath(schema, from, to) : null;
  const target = pick(victim, names[0]);
  const impact = target ? deleteImpact(schema, target) : null;

  const marks: Marks = useMemo(() => {
    const tables: Record<string, Mark> = {};
    const columns = new Set<string>();
    const lines = new Set<string>();
    if (mode === 'review' && finding) {
      for (const { table, column } of finding.targets) {
        tables[table] = finding.level;
        if (column) columns.add(`${table}.${column}`);
      }
    } else if (mode === 'join' && path) {
      for (const hop of path.hops) {
        tables[hop.from] = 'path';
        tables[hop.to] = 'path';
        lines.add(hop.relation.id);
      }
      if (from) tables[from] = 'pick';
      if (to) tables[to] = 'pick';
    } else if (mode === 'delete' && impact) {
      for (const effect of impact.effects) {
        tables[effect.table] = effect.kind === 'root' ? 'pick' : effect.kind;
        if (effect.via) lines.add(effect.via.id);
      }
    }
    return { tables, columns, relations: lines };
  }, [mode, finding, path, from, to, impact]);

  const onPick =
    mode === 'join'
      ? (name: string) =>
          setJoin((now) => ({ ...now, [now.next]: name, next: now.next === 'from' ? 'to' : 'from' }))
      : mode === 'delete'
        ? (name: string) => setVictim(name)
        : undefined;

  const all = relations(schema);
  const setSafeguard = (change: Partial<Safeguards>) => setSafeguards({ ...safeguards, ...change });

  return (
    <div className="okfw-sqlerd">
      {scenarios.length > 1 && (
        <Presets
          presets={scenarios.map(({ id, title }) => ({ id, label: title }))}
          active={scenario.id}
          probe=""
          onChoose={(chosen) => setScenarioId(chosen.id)}
        />
      )}
      {scenario.blurb && <Note>{scenario.blurb}</Note>}

      {schema.tables.length === 0 ? (
        <Note tone="warn">
          No CREATE TABLE statement found. Write one under the widget name, or use the Edit the SQL tab.
        </Note>
      ) : (
        <>
          <div className="okfw-erd-bar">
            <button type="button" aria-pressed={fit} onClick={() => setFit(!fit)}>
              {fit ? 'Fit to width' : 'Actual size'}
            </button>
            <button type="button" onClick={() => setExpanded(true)}>
              Expand
            </button>
            <span className="okfw-muted">
              {mode === 'join' && 'Click two tables to pick the ends. '}
              {mode === 'delete' && 'Click a table to delete a row from it. '}
            </span>
          </div>
          <ErdDiagram
            schema={schema}
            marks={marks}
            added={added}
            fit={fit}
            expanded={expanded}
            onCollapse={() => setExpanded(false)}
            onPick={onPick}
          />
          <p className="okfw-erd-key">
            <KeyGlyph kind="one" /> <code>||</code> exactly one (NOT NULL key) ·{' '}
            <KeyGlyph kind="zeroOne" /> <code>|o</code> / <code>o|</code> zero or one (nullable or
            unique key) · <KeyGlyph kind="zeroMany" mirrored /> <code>o{'{'}</code> zero or more. Drawn
            from the constraints, not by hand.
          </p>
        </>
      )}

      <div className="okfw-tabs" role="tablist" aria-label="What to look at">
        {MODES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={mode === candidate.id}
            onClick={() => setMode(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={MODES.find((candidate) => candidate.id === mode)?.label}>
        {mode === 'review' && (
          <>
            <p className="okfw-big-line" data-testid="erd-health">
              <strong className="okfw-big" data-bad={health.good < health.total}>
                {health.good} of {health.total}
              </strong>{' '}
              design checks pass
            </p>
            <ul className="okfw-plain okfw-findings">
              {findings.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    data-level={candidate.level}
                    aria-pressed={candidate.id === finding?.id}
                    onClick={() => setFindingId(candidate.id)}
                  >
                    <span className="okfw-finding-icon" aria-hidden="true">
                      {ICON[candidate.level]}
                    </span>
                    {candidate.title}
                  </button>
                </li>
              ))}
            </ul>
            {finding && (
              <Note tone={finding.level === 'warn' ? 'warn' : 'note'}>
                {finding.theory}
                {finding.targets.length > 0 && (
                  <>
                    {' '}
                    <span className="okfw-muted">
                      Highlighted:{' '}
                      {finding.targets.map((t) => (t.column ? `${t.table}.${t.column}` : t.table)).join(', ')}.
                    </span>
                  </>
                )}
              </Note>
            )}
          </>
        )}

        {mode === 'join' && (
          <>
            <div className="okfw-row">
              <label>
                From{' '}
                <select
                  value={from ?? ''}
                  onChange={(event) => setJoin({ ...join, from: event.target.value })}
                >
                  {names.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>{' '}
              <label>
                to{' '}
                <select value={to ?? ''} onChange={(event) => setJoin({ ...join, to: event.target.value })}>
                  {names.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>
            {path ? (
              <>
                <pre className="okfw-sql" data-testid="erd-join">{path.sql}</pre>
                <Facts
                  rows={[
                    ['Hops', path.hops.length],
                    [
                      'Rows multiply',
                      path.fanOut === 0
                        ? 'never: every hop goes from a child to its one parent'
                        : `${path.fanOut} time${path.fanOut === 1 ? '' : 's'}`,
                    ],
                  ]}
                />
                {path.fanOut >= 2 && (
                  <Note tone="warn">
                    Two or more hops from parent to child make one row fan out twice. Summing a column
                    from the first table now counts each row once per combination: aggregate each side
                    separately, then join.
                  </Note>
                )}
              </>
            ) : (
              <Note tone="warn">No chain of foreign keys joins these two tables.</Note>
            )}
          </>
        )}

        {mode === 'delete' && impact && target && (
          <>
            <label className="okfw-row">
              Delete one row from{' '}
              <select value={target} onChange={(event) => setVictim(event.target.value)}>
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <ul className="okfw-plain okfw-effects" data-testid="erd-delete">
              {impact.effects.map((effect, index) => (
                <li key={index} data-kind={effect.kind} style={{ paddingLeft: `${effect.depth * 16}px` }}>
                  {effect.kind === 'root' ? (
                    <>
                      <code>{effect.table}</code>: the row you delete
                    </>
                  ) : (
                    <>
                      rows in <code>{effect.table}</code> {EFFECT_TEXT[effect.kind]}{' '}
                      <span className="okfw-muted">(ON DELETE {effect.via?.key.onDelete.toUpperCase()})</span>
                    </>
                  )}
                </li>
              ))}
              {impact.effects.length === 1 && <li className="okfw-muted">Nothing references this table.</li>}
            </ul>
            {impact.blocked ? (
              <Note tone="warn">
                Refused: a foreign key with NO ACTION or RESTRICT stops the delete while a row still
                points at it. That is the safe default; CASCADE is a choice to make on purpose.
              </Note>
            ) : (
              <Note>
                The delete goes through. Check that every table marked deleted is really part of the row
                you are removing.
              </Note>
            )}
          </>
        )}

        {mode === 'sql' && (
          <>
            <textarea
              className="okfw-editor"
              aria-label="Schema SQL"
              spellCheck={false}
              rows={Math.min(24, Math.max(8, sql.split('\n').length))}
              value={sql}
              onChange={(event) => setEdits({ ...edits, [scenario.id]: event.target.value })}
            />
            <button
              type="button"
              disabled={edits[scenario.id] === undefined}
              onClick={() => setEdits(Object.fromEntries(Object.entries(edits).filter(([id]) => id !== scenario.id)))}
            >
              Reset this scenario
            </button>
            <p className="okfw-muted">
              Edit, then open the other tabs: the diagram and the review follow. Try deleting a
              REFERENCES clause.
            </p>
          </>
        )}
      </div>

      <fieldset className="okfw-safeguards">
        <legend>Switch off a safeguard</legend>
        <label className="okfw-toggle">
          <input
            type="checkbox"
            data-probe
            checked={safeguards.foreignKeys}
            onChange={(event) => setSafeguard({ foreignKeys: event.target.checked })}
          />{' '}
          Declare the foreign keys
          <span className="okfw-reason">without them the database cannot refuse an orphan row</span>
        </label>
        <label className="okfw-toggle">
          <input
            type="checkbox"
            checked={safeguards.indexes}
            onChange={(event) => setSafeguard({ indexes: event.target.checked })}
          />{' '}
          Keep the CREATE INDEX statements
          <span className="okfw-reason">without them joins and cascades scan the child table</span>
        </label>
      </fieldset>

      <Facts
        rows={[
          ['Tables', added.size > 0 ? `${names.length} (${added.size} not in ${scenarios[0]!.title})` : names.length],
          ['Relationships', all.length],
          ...(all.length > 0 && all.length <= 4
            ? [['Notation', all.map((relation) => `${relation.parent} ${notation(relation)} ${relation.child}`).join(', ')] as const]
            : []),
        ]}
      />
      <ModelNote>
        A model: <code>models/ddl.ts</code> reads the common subset of PostgreSQL and SQLite DDL and skips
        the rest, and the design checks in <code>models/schema.ts</code> are heuristics from widely taught
        rules, not a proof. Nothing here runs against a database.
      </ModelNote>
    </div>
  );
}
