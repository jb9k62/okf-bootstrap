/**
 * What can be read off a schema without any data: its relationships (and the crow's-foot
 * notation each one gets), a design review, the join path between two tables, and what
 * deleting a row would do. All pure, so each is pinned by a test.
 */

import type { ForeignKey, Schema, Table } from './ddl.ts';

export const tableOf = (schema: Schema, name: string): Table | undefined =>
  schema.tables.find((table) => table.name === name);

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/** `columns` are the leading columns of `key`, in any order: the key can answer a lookup by them. */
const leads = (key: readonly string[], columns: readonly string[]) =>
  key.length >= columns.length && sameSet(key.slice(0, columns.length), columns);

// --- Relationships -------------------------------------------------------------------

export interface Relation {
  id: string;
  child: string;
  parent: string;
  key: ForeignKey;
  /** Every foreign key column is NOT NULL, so each child row has exactly one parent. */
  mandatory: boolean;
  /** The foreign key is also unique, so a parent has at most one child row: one-to-one. */
  single: boolean;
}

/** Every foreign key whose parent table is in the schema. */
export function relations(schema: Schema): Relation[] {
  const found: Relation[] = [];
  for (const child of schema.tables) {
    for (const key of child.foreignKeys) {
      if (!tableOf(schema, key.refTable)) continue;
      found.push({
        id: `${child.name}.${key.columns.join('+')}`,
        child: child.name,
        parent: key.refTable,
        key,
        mandatory: key.columns.every((column) => child.columns.find((c) => c.name === column)?.notNull),
        single:
          sameSet(child.primaryKey, key.columns) || child.uniques.some((unique) => sameSet(unique, key.columns)),
      });
    }
  }
  return found;
}

/** The end markers, as Mermaid's erDiagram writes them: `||--o{`, `|o--o|`. */
export function notation(relation: Relation): string {
  return `${relation.mandatory ? '||' : '|o'}--${relation.single ? 'o|' : 'o{'}`;
}

/** One end of a relationship line, by how many rows sit at it. */
export type End = 'one' | 'zeroOne' | 'zeroMany';

/** The words for each end. The viewer's generated ER key uses the same ones; keep them in step. */
export const END_WORDS: Readonly<Record<End, string>> = {
  one: 'exactly one',
  zeroOne: 'zero or one',
  zeroMany: 'zero or more',
};

/** How many parent rows each child row has (`parent`), and how many child rows each parent has (`child`). */
export function ends(relation: Relation): { parent: End; child: End } {
  return { parent: relation.mandatory ? 'one' : 'zeroOne', child: relation.single ? 'zeroOne' : 'zeroMany' };
}

/** A relationship in words, read from either side: the reading the line ends stand for. */
export function describe(relation: Relation): string {
  const { parent, child } = ends(relation);
  return (
    `each ${relation.child} is linked to ${END_WORDS[parent]} ${relation.parent}; ` +
    `each ${relation.parent} is linked to ${END_WORDS[child]} ${relation.child}`
  );
}

// --- Design review -------------------------------------------------------------------

export interface Target {
  table: string;
  column?: string;
}

export interface Finding {
  id: string;
  /** `good` and `warn` count towards the score; `info` only teaches. */
  level: 'good' | 'warn' | 'info';
  title: string;
  /** The principle behind the check. */
  theory: string;
  targets: Target[];
}

const isKeyLike = (column: string) => /_id$/.test(column);
const MONEY = /(price|amount|cost|total|fee|balance|salary|charge|rate)/;
const INEXACT = /^(float|real|double|double precision|float[48])(\(.*\))?$/;
const INSTANT = /_at$/;

function check(
  findings: Finding[],
  id: string,
  offenders: Target[],
  text: { good: string; warn: string; theory: string },
) {
  findings.push({
    id,
    level: offenders.length === 0 ? 'good' : 'warn',
    title: offenders.length === 0 ? text.good : text.warn,
    theory: text.theory,
    targets: offenders,
  });
}

/** Checks a schema against a handful of widely taught design rules. Heuristics, not proof. */
export function review(schema: Schema): Finding[] {
  const findings: Finding[] = [];
  const tables = schema.tables;
  const all = relations(schema);
  const keys = tables.flatMap((table) => table.foreignKeys.map((key) => ({ table, key })));

  check(
    findings,
    'primary-keys',
    tables.filter((table) => table.primaryKey.length === 0).map((table) => ({ table: table.name })),
    {
      good: 'Every table has a primary key',
      warn: 'Tables with no primary key',
      theory:
        'Entity integrity: a row you cannot identify is a row you cannot update, reference or de-duplicate. Every table needs a primary key, and it is never NULL.',
    },
  );

  if (keys.length > 0 || tables.some((t) => t.columns.some((c) => isKeyLike(c.name)))) {
    const declared = new Set(keys.flatMap(({ table, key }) => key.columns.map((c) => `${table.name}.${c}`)));
    check(
      findings,
      'declared-keys',
      tables.flatMap((table) =>
        table.columns
          .filter(
            (column) =>
              isKeyLike(column.name) &&
              !declared.has(`${table.name}.${column.name}`) &&
              !(table.primaryKey.length === 1 && table.primaryKey[0] === column.name),
          )
          .map((column) => ({ table: table.name, column: column.name })),
      ),
      {
        good: 'Every *_id column is a declared foreign key',
        warn: 'Columns that look like foreign keys but are not declared',
        theory:
          'Referential integrity: only a FOREIGN KEY constraint stops a row pointing at a parent that does not exist. A column that merely holds an id is a convention, and conventions get broken.',
      },
    );
  }

  if (keys.length > 0) {
    check(
      findings,
      'dangling-keys',
      keys
        .filter(({ key }) => !tableOf(schema, key.refTable))
        .map(({ table, key }) => ({ table: table.name, column: key.columns[0] })),
      {
        good: 'Every foreign key points at a table in this schema',
        warn: 'Foreign keys that point at a table this schema does not define',
        theory: 'A foreign key can only protect a relationship whose other end exists here.',
      },
    );

    check(
      findings,
      'indexed-keys',
      keys
        .filter(({ table, key }) => {
          const covering = [table.primaryKey, ...table.uniques, ...table.indexes];
          return !covering.some((index) => leads(index, key.columns));
        })
        .map(({ table, key }) => ({ table: table.name, column: key.columns[0] })),
      {
        good: 'Every foreign key is indexed',
        warn: 'Foreign keys with no index',
        theory:
          'Joins go from parent to child through the foreign key, and so does every cascading delete. Without an index the database scans the whole child table each time. A primary or unique key that starts with the column also counts.',
      },
    );

    const junctions = tables.filter(
      (table) =>
        table.primaryKey.length >= 2 &&
        table.foreignKeys.length >= 2 &&
        table.primaryKey.every((column) => table.foreignKeys.some((key) => key.columns.includes(column))),
    );
    if (junctions.length > 0) {
      findings.push({
        id: 'junction-tables',
        level: 'good',
        title: `Many-to-many relationships resolved by a junction table: ${junctions.map((t) => t.name).join(', ')}`,
        theory:
          'A many-to-many relationship cannot be stored in either table without repeating values. A table of pairs, keyed by both foreign keys, holds it once and lets the database reject a duplicate pair.',
        targets: junctions.map((table) => ({ table: table.name })),
      });
    }

    const copies: Target[] = [];
    for (const { table, key } of keys) {
      const parent = tableOf(schema, key.refTable);
      const only = key.columns.length === 1 ? key.columns[0]! : '';
      if (!parent || !isKeyLike(only)) continue;
      const prefix = only.replace(/_id$/, '_');
      for (const column of table.columns) {
        const field = column.name.startsWith(prefix) ? column.name.slice(prefix.length) : '';
        if (field && parent.columns.some((c) => c.name === field) && !parent.primaryKey.includes(field)) {
          copies.push({ table: table.name, column: column.name });
        }
      }
    }
    check(findings, 'copied-attributes', copies, {
      good: 'No attribute is copied down from a parent table',
      warn: 'Columns that copy a value the parent table already holds',
      theory:
        'Third normal form: every column should depend on the key of its own table, not on another table. A copy of the parent’s name must be updated in two places, and sooner or later the two disagree. Join to it instead.',
    });
  }

  const repeating: Target[] = [];
  for (const table of tables) {
    const groups = new Map<string, string[]>();
    for (const column of table.columns) {
      const base = column.name.match(/^(.*?)_?\d+$/)?.[1];
      if (base) groups.set(base, [...(groups.get(base) ?? []), column.name]);
    }
    for (const members of groups.values()) {
      if (members.length >= 2) repeating.push(...members.map((column) => ({ table: table.name, column })));
    }
  }
  check(findings, 'repeating-groups', repeating, {
    good: 'No repeating groups of columns',
    warn: 'Numbered columns that repeat one value (phone1, phone2, ...)',
    theory:
      'First normal form: one value per column, no repeating groups. Numbered columns cap the count, make every query list them all, and leave NULL holes. Move them to a child table, one row each.',
  });

  const money = tables.flatMap((table) =>
    table.columns
      .filter((column) => MONEY.test(column.name) && INEXACT.test(column.type))
      .map((column) => ({ table: table.name, column: column.name })),
  );
  if (money.length > 0 || tables.some((t) => t.columns.some((c) => MONEY.test(c.name)))) {
    check(findings, 'exact-money', money, {
      good: 'Money is stored exactly',
      warn: 'Money stored as a floating-point number',
      theory:
        'Binary floating point cannot represent 0.10 exactly, and the error adds up over a ledger. Use numeric(p, s), or whole minor units (cents) in an integer.',
    });
  }

  const instants = tables.flatMap((table) =>
    table.columns.filter((column) => INSTANT.test(column.name)).map((column) => ({ table: table.name, column })),
  );
  if (instants.length > 0) {
    check(
      findings,
      'time-zones',
      instants
        .filter(({ column }) => /^(timestamp|datetime)(\(\d\))?( without time zone)?$/.test(column.type))
        .map(({ table, column }) => ({ table: table, column: column.name })),
      {
        good: 'Instants are stored with their time zone',
        warn: 'Timestamps stored without a time zone',
        theory:
          'A timestamp with no zone is a wall-clock reading, and the reader has to guess whose. An instant belongs in timestamptz, which stores it as UTC, so every client agrees what moment it was.',
      },
    );
  }

  const optional = all.filter((relation) => !relation.mandatory);
  if (optional.length > 0) {
    findings.push({
      id: 'optional-keys',
      level: 'info',
      title: `Optional relationships: ${optional.length} nullable foreign key${optional.length === 1 ? '' : 's'}`,
      theory:
        'A nullable foreign key means a row may have no parent, drawn as a ring at the parent end (zero or one). NOT NULL makes the parent mandatory, drawn as a bar (exactly one).',
      targets: optional.map((relation) => ({ table: relation.child, column: relation.key.columns[0] })),
    });
  }

  const linked = new Set(all.flatMap((relation) => [relation.child, relation.parent]));
  const loose = tables.filter((table) => !linked.has(table.name));
  if (tables.length > 1 && loose.length > 0) {
    findings.push({
      id: 'unconnected',
      level: 'info',
      title: `Tables with no relationship: ${loose.map((table) => table.name).join(', ')}`,
      theory:
        'A table that nothing references and that references nothing is either a standalone list (settings, a lookup) or a relationship nobody declared.',
      targets: loose.map((table) => ({ table: table.name })),
    });
  }

  return findings;
}

/** How many of the scored checks pass. */
export function score(findings: readonly Finding[]): { good: number; total: number } {
  const scored = findings.filter((finding) => finding.level !== 'info');
  return { good: scored.filter((finding) => finding.level === 'good').length, total: scored.length };
}

// --- Join path -----------------------------------------------------------------------

export interface Hop {
  from: string;
  to: string;
  relation: Relation;
  /** `down` goes from a parent to its children: one row fans out into many. */
  direction: 'up' | 'down';
}

export interface JoinPath {
  hops: Hop[];
  sql: string;
  /** How many hops multiply the rows. */
  fanOut: number;
}

/** The fewest foreign key hops from one table to another, in either direction, with its SQL. */
export function joinPath(schema: Schema, from: string, to: string): JoinPath | null {
  if (!tableOf(schema, from) || !tableOf(schema, to)) return null;
  const all = relations(schema);
  const reached = new Map<string, Hop[]>([[from, []]]);
  const queue = [from];
  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const relation of all) {
      const next =
        relation.child === here ? { name: relation.parent, direction: 'up' as const }
        : relation.parent === here ? { name: relation.child, direction: 'down' as const }
        : null;
      if (!next || reached.has(next.name)) continue;
      reached.set(next.name, [
        ...reached.get(here)!,
        { from: here, to: next.name, relation, direction: next.direction },
      ]);
      queue.push(next.name);
    }
  }
  const hops = reached.get(to);
  if (!hops) return null;
  const lines = [`SELECT *`, `FROM ${from}`];
  for (const hop of hops) {
    const on = hop.relation.key.columns.map(
      (column, index) =>
        `${hop.relation.child}.${column} = ${hop.relation.parent}.${hop.relation.key.refColumns[index] ?? '?'}`,
    );
    lines.push(`JOIN ${hop.to} ON ${on.join(' AND ')}`);
  }
  return { hops, sql: lines.join('\n'), fanOut: hops.filter((hop) => hop.direction === 'down').length };
}

// --- Delete impact -------------------------------------------------------------------

export interface Effect {
  table: string;
  /** What happens to the rows of `table` that point at the row being deleted. */
  kind: 'root' | 'delete' | 'nullify' | 'blocked';
  depth: number;
  via: Relation | null;
}

/** What deleting one row of `table` does to the rows that depend on it, following ON DELETE. */
export function deleteImpact(schema: Schema, table: string): { effects: Effect[]; blocked: boolean } {
  const all = relations(schema);
  const effects: Effect[] = [{ table, kind: 'root', depth: 0, via: null }];
  const seen = new Set([table]);
  const walk = (parent: string, depth: number) => {
    for (const relation of all.filter((candidate) => candidate.parent === parent)) {
      const child = tableOf(schema, relation.child)!;
      const { onDelete } = relation.key;
      const nullable = relation.key.columns.every((c) => !child.columns.find((x) => x.name === c)?.notNull);
      const kind: Effect['kind'] =
        onDelete === 'cascade' ? 'delete'
        : onDelete === 'set default' || (onDelete === 'set null' && nullable) ? 'nullify'
        : 'blocked';
      effects.push({ table: relation.child, kind, depth, via: relation });
      if (kind === 'delete' && !seen.has(relation.child)) {
        seen.add(relation.child);
        walk(relation.child, depth + 1);
      }
    }
  };
  walk(table, 1);
  return { effects, blocked: effects.some((effect) => effect.kind === 'blocked') };
}

// --- What-if -------------------------------------------------------------------------

export interface Safeguards {
  foreignKeys: boolean;
  indexes: boolean;
}

/** The schema with the chosen safeguards taken away, so a reader can watch what breaks. */
export function withSafeguards(schema: Schema, on: Safeguards): Schema {
  return {
    tables: schema.tables.map((table) => ({
      ...table,
      foreignKeys: on.foreignKeys ? table.foreignKeys : [],
      indexes: on.indexes ? table.indexes : [],
    })),
  };
}
