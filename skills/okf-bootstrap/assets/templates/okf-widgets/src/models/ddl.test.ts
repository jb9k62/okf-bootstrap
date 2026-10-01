import { describe, expect, it } from 'vitest';
import { parseDdl, parseScenarios } from './ddl.ts';

const SQL = `
  -- carriers deliver parcels
  CREATE TABLE carrier (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    poll_interval_s int NOT NULL DEFAULT 60 CHECK (poll_interval_s > 0)
  );
  CREATE TABLE "public"."parcel" (
    id uuid PRIMARY KEY,
    carrier_id text NOT NULL REFERENCES carrier(id) ON DELETE CASCADE,
    price numeric(10, 2),
    status text
  );
  CREATE TABLE tracking_event (
    parcel_id uuid NOT NULL,
    seq int NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    PRIMARY KEY (parcel_id, seq),
    CONSTRAINT fk_parcel FOREIGN KEY (parcel_id) REFERENCES parcel ON DELETE SET NULL
  );
  CREATE INDEX parcel_carrier ON parcel (carrier_id);
  CREATE UNIQUE INDEX ON parcel (status, id);
  CREATE INDEX by_lower ON parcel (lower(status));
  INSERT INTO carrier VALUES ('x', 'y', 1);
`;

describe('parseDdl', () => {
  const schema = parseDdl(SQL);
  const table = (name: string) => schema.tables.find((t) => t.name === name)!;

  it('reads tables, columns, types and nullability', () => {
    expect(schema.tables.map((t) => t.name)).toEqual(['carrier', 'parcel', 'tracking_event']);
    expect(table('carrier').columns).toEqual([
      { name: 'id', type: 'text', notNull: true },
      { name: 'name', type: 'text', notNull: true },
      { name: 'poll_interval_s', type: 'int', notNull: true },
    ]);
    const parcel = table('parcel');
    expect(parcel.columns.find((c) => c.name === 'price')).toEqual({ name: 'price', type: 'numeric(10, 2)', notNull: false });
    expect(table('tracking_event').columns[2]!.type).toBe('timestamp with time zone');
  });

  it('reads keys: inline and table-level, with a composite primary key', () => {
    expect(table('carrier').primaryKey).toEqual(['id']);
    expect(table('carrier').uniques).toEqual([['name']]);
    expect(table('tracking_event').primaryKey).toEqual(['parcel_id', 'seq']);
    expect(table('tracking_event').columns[1]!.notNull).toBe(true);
  });

  it('reads foreign keys with their delete rule, resolving a bare REFERENCES to the parent key', () => {
    expect(table('parcel').foreignKeys).toEqual([
      { columns: ['carrier_id'], refTable: 'carrier', refColumns: ['id'], onDelete: 'cascade' },
    ]);
    expect(table('tracking_event').foreignKeys).toEqual([
      { columns: ['parcel_id'], refTable: 'parcel', refColumns: ['id'], onDelete: 'set null' },
    ]);
  });

  it('reads indexes, keeps unique ones as keys, and ignores expression indexes', () => {
    expect(table('parcel').indexes).toEqual([['carrier_id']]);
    expect(table('parcel').uniques).toEqual([['status', 'id']]);
  });

  it('defaults the delete rule to NO ACTION, and reads ALTER TABLE ... ADD FOREIGN KEY', () => {
    const altered = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (id int PRIMARY KEY, a_id int);
      ALTER TABLE ONLY b ADD CONSTRAINT b_a FOREIGN KEY (a_id) REFERENCES a (id);
    `);
    expect(altered.tables[1]!.foreignKeys).toEqual([
      { columns: ['a_id'], refTable: 'a', refColumns: ['id'], onDelete: 'no action' },
    ]);
  });

  it('finds nothing in text with no CREATE TABLE', () => {
    expect(parseDdl('SELECT 1; -- nothing here').tables).toEqual([]);
  });
});

describe('parseScenarios', () => {
  it('splits on scenario comments and keeps each one as SQL', () => {
    const scenarios = parseScenarios(
      '-- scenario: Basic | Three tables\nCREATE TABLE a (id int);\n\n-- scenario: Advanced\nCREATE TABLE b (id int);',
    );
    expect(scenarios.map((s) => [s.title, s.blurb, s.sql])).toEqual([
      ['Basic', 'Three tables', 'CREATE TABLE a (id int);'],
      ['Advanced', '', 'CREATE TABLE b (id int);'],
    ]);
  });

  it('treats text with no marker as one scenario', () => {
    expect(parseScenarios('CREATE TABLE a (id int);')).toHaveLength(1);
  });
});
