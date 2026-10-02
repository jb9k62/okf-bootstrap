import { describe, expect, it } from 'vitest';
import { parseDdl } from './ddl.ts';
import { layout } from './layout.ts';
import {
  deleteImpact,
  joinPath,
  describe as describeRelation,
  ends,
  notation,
  relations,
  review,
  score,
  withSafeguards,
} from './schema.ts';

const SHOP = parseDdl(`
  CREATE TABLE customer (id int PRIMARY KEY, name text NOT NULL);
  CREATE TABLE product  (id int PRIMARY KEY, title text NOT NULL, price numeric(10,2) NOT NULL);
  CREATE TABLE "order" (
    id int PRIMARY KEY,
    customer_id int NOT NULL REFERENCES customer (id),
    coupon_id int REFERENCES coupon (id) ON DELETE SET NULL,
    placed_at timestamptz NOT NULL
  );
  CREATE TABLE coupon (id int PRIMARY KEY, code text NOT NULL UNIQUE);
  CREATE TABLE order_line (
    order_id   int NOT NULL REFERENCES "order" (id) ON DELETE CASCADE,
    product_id int NOT NULL REFERENCES product (id),
    qty int NOT NULL,
    PRIMARY KEY (order_id, product_id)
  );
  CREATE TABLE customer_profile (customer_id int PRIMARY KEY REFERENCES customer (id), bio text);
  CREATE INDEX order_customer ON "order" (customer_id);
  CREATE INDEX order_coupon ON "order" (coupon_id);
  CREATE INDEX line_product ON order_line (product_id);
`);

const findingOf = (schema: typeof SHOP, id: string) => review(schema).find((f) => f.id === id);

describe('relations and notation', () => {
  const byId = Object.fromEntries(relations(SHOP).map((r) => [r.id, r]));

  it('derives each end from NOT NULL and uniqueness', () => {
    expect(notation(byId['order.customer_id']!)).toBe('||--o{'); // mandatory parent, many children
    expect(notation(byId['order.coupon_id']!)).toBe('|o--o{'); // nullable: the parent is optional
    expect(notation(byId['customer_profile.customer_id']!)).toBe('||--o|'); // the key is the PK: one-to-one
  });

  it('says each relationship in words, from either side', () => {
    expect(ends(byId['order.customer_id']!)).toEqual({ parent: 'one', child: 'zeroMany' });
    expect(describeRelation(byId['order.customer_id']!)).toBe(
      'each order is linked to exactly one customer; each customer is linked to zero or more order',
    );
    expect(describeRelation(byId['order.coupon_id']!)).toMatch(/to zero or one coupon; .* zero or more order$/);
    expect(describeRelation(byId['customer_profile.customer_id']!)).toMatch(/exactly one customer; .* zero or one customer_profile$/);
  });

  it('leaves out a foreign key whose parent is not in the schema', () => {
    const lonely = parseDdl('CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b (id));');
    expect(relations(lonely)).toEqual([]);
  });
});

describe('review', () => {
  it('passes a well-formed schema and notes the optional relationship', () => {
    const findings = review(SHOP);
    expect(findings.filter((f) => f.level === 'warn')).toEqual([]);
    expect(score(findings)).toEqual({ good: 9, total: 9 });
    expect(findings.find((f) => f.id === 'junction-tables')!.targets).toEqual([{ table: 'order_line' }]);
    expect(findings.find((f) => f.id === 'optional-keys')!.targets).toEqual([{ table: 'order', column: 'coupon_id' }]);
  });

  it('flags a table with no primary key', () => {
    const schema = parseDdl('CREATE TABLE log (line text);');
    expect(findingOf(schema, 'primary-keys')).toMatchObject({ level: 'warn', targets: [{ table: 'log' }] });
  });

  it('flags an *_id column with no foreign key, and a foreign key with no index', () => {
    const schema = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (id int PRIMARY KEY, a_id int NOT NULL, owner_id int NOT NULL REFERENCES a (id));
    `);
    expect(findingOf(schema, 'declared-keys')!.targets).toEqual([{ table: 'b', column: 'a_id' }]);
    expect(findingOf(schema, 'indexed-keys')!.targets).toEqual([{ table: 'b', column: 'owner_id' }]);
  });

  it('counts a primary or unique key that leads with the column as an index', () => {
    const schema = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (a_id int NOT NULL REFERENCES a (id), n int NOT NULL, PRIMARY KEY (a_id, n));
    `);
    expect(findingOf(schema, 'indexed-keys')!.level).toBe('good');
  });

  it('flags the second key of a junction table when only the first leads the primary key', () => {
    const findings = review(parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (id int PRIMARY KEY);
      CREATE TABLE ab (a_id int NOT NULL REFERENCES a (id), b_id int NOT NULL REFERENCES b (id), PRIMARY KEY (a_id, b_id));
    `));
    expect(findings.find((f) => f.id === 'indexed-keys')!.targets).toEqual([{ table: 'ab', column: 'b_id' }]);
  });

  it('flags repeating groups, copied parent attributes, float money and naive timestamps', () => {
    const schema = parseDdl(`
      CREATE TABLE carrier (id int PRIMARY KEY, name text NOT NULL);
      CREATE TABLE parcel (
        id int PRIMARY KEY,
        carrier_id int NOT NULL REFERENCES carrier (id),
        carrier_name text,
        phone1 text, phone2 text,
        shipping_fee real,
        created_at timestamp
      );
      CREATE INDEX ON parcel (carrier_id);
    `);
    expect(findingOf(schema, 'repeating-groups')!.targets).toEqual([
      { table: 'parcel', column: 'phone1' },
      { table: 'parcel', column: 'phone2' },
    ]);
    expect(findingOf(schema, 'copied-attributes')!.targets).toEqual([{ table: 'parcel', column: 'carrier_name' }]);
    expect(findingOf(schema, 'exact-money')!.targets).toEqual([{ table: 'parcel', column: 'shipping_fee' }]);
    expect(findingOf(schema, 'time-zones')!.targets).toEqual([{ table: 'parcel', column: 'created_at' }]);
  });

  it('turns to warnings when the reader removes the foreign keys', () => {
    const findings = review(withSafeguards(SHOP, { foreignKeys: false, indexes: true }));
    expect(findings.find((f) => f.id === 'declared-keys')!.level).toBe('warn');
    expect(score(findings).good).toBeLessThan(9);
  });

  it('turns an indexed schema into warnings when the reader drops the indexes', () => {
    const findings = review(withSafeguards(SHOP, { foreignKeys: true, indexes: false }));
    expect(findings.find((f) => f.id === 'indexed-keys')!.targets).toEqual([
      { table: 'order', column: 'customer_id' },
      { table: 'order', column: 'coupon_id' },
      { table: 'order_line', column: 'product_id' },
    ]);
  });
});

describe('joinPath', () => {
  it('finds the shortest path, writes the joins, and counts the fan-out', () => {
    const path = joinPath(SHOP, 'customer', 'product')!;
    expect(path.hops.map((hop) => `${hop.from}>${hop.to}:${hop.direction}`)).toEqual([
      'customer>order:down',
      'order>order_line:down',
      'order_line>product:up',
    ]);
    expect(path.fanOut).toBe(2);
    expect(path.sql).toBe(
      [
        'SELECT *',
        'FROM customer',
        'JOIN order ON order.customer_id = customer.id',
        'JOIN order_line ON order_line.order_id = order.id',
        'JOIN product ON order_line.product_id = product.id',
      ].join('\n'),
    );
  });

  it('is empty for the same table, and null when the tables are not connected', () => {
    expect(joinPath(SHOP, 'coupon', 'coupon')).toMatchObject({ hops: [], fanOut: 0 });
    const split = parseDdl('CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (id int PRIMARY KEY);');
    expect(joinPath(split, 'a', 'b')).toBeNull();
  });
});

describe('deleteImpact', () => {
  it('follows CASCADE down, nullifies SET NULL, and is blocked by the default rule', () => {
    const impact = deleteImpact(SHOP, 'customer');
    // customer -> order (NO ACTION) blocks; customer -> customer_profile (NO ACTION) blocks
    expect(impact.blocked).toBe(true);
    expect(impact.effects.map((e) => `${e.table}:${e.kind}`)).toEqual([
      'customer:root',
      'order:blocked',
      'customer_profile:blocked',
    ]);
  });

  it('reaches grandchildren through a cascade', () => {
    const impact = deleteImpact(SHOP, 'coupon');
    expect(impact.effects.map((e) => `${e.table}:${e.kind}`)).toEqual(['coupon:root', 'order:nullify']);
    const cascading = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a (id) ON DELETE CASCADE);
      CREATE TABLE c (id int PRIMARY KEY, b_id int REFERENCES b (id) ON DELETE CASCADE);
    `);
    expect(deleteImpact(cascading, 'a')).toMatchObject({
      blocked: false,
      effects: [
        { table: 'a', kind: 'root' },
        { table: 'b', kind: 'delete', depth: 1 },
        { table: 'c', kind: 'delete', depth: 2 },
      ],
    });
  });

  it('blocks SET NULL on a NOT NULL column, and survives a cycle', () => {
    const tight = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY);
      CREATE TABLE b (id int PRIMARY KEY, a_id int NOT NULL REFERENCES a (id) ON DELETE SET NULL);
    `);
    expect(deleteImpact(tight, 'a').blocked).toBe(true);
    const loop = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY, b_id int);
      CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a (id) ON DELETE CASCADE);
      ALTER TABLE a ADD FOREIGN KEY (b_id) REFERENCES b (id) ON DELETE CASCADE;
    `);
    expect(deleteImpact(loop, 'a').effects.length).toBeLessThan(10);
  });
});

describe('layout', () => {
  it('puts a parent to the left of its children, and every table in its own place', () => {
    const { boxes } = layout(SHOP);
    expect(boxes['customer']!.x).toBeLessThan(boxes['order']!.x);
    expect(boxes['order']!.x).toBeLessThan(boxes['order_line']!.x);
    expect(Object.keys(boxes).sort()).toEqual(SHOP.tables.map((t) => t.name).sort());
    const places = new Set(Object.values(boxes).map((b) => `${b.x},${b.y}`));
    expect(places.size).toBe(SHOP.tables.length);
  });

  it('terminates on a cycle', () => {
    const loop = parseDdl(`
      CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b (id));
      CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a (id));
    `);
    expect(Object.keys(layout(loop).boxes)).toHaveLength(2);
  });
});
