/**
 * A small reader for the SQL a schema is written in: CREATE TABLE (columns, inline and table
 * constraints), CREATE [UNIQUE] INDEX, and ALTER TABLE ... ADD FOREIGN KEY, in the PostgreSQL
 * and SQLite dialects' common subset. It is not a SQL parser: anything it does not recognise
 * (INSERT, views, triggers, CHECK bodies) is skipped, so a real schema dump can be pasted in.
 */

export type DeleteAction = 'cascade' | 'set null' | 'set default' | 'restrict' | 'no action';

export interface Column {
  name: string;
  type: string;
  /** NOT NULL, or part of the primary key. */
  notNull: boolean;
}

export interface ForeignKey {
  columns: string[];
  refTable: string;
  /** Empty when the table does not exist in the schema and none were written. */
  refColumns: string[];
  /** SQL's default when ON DELETE is left out is NO ACTION. */
  onDelete: DeleteAction;
}

export interface Table {
  name: string;
  columns: Column[];
  primaryKey: string[];
  /** UNIQUE constraints and CREATE UNIQUE INDEX, one column list each. */
  uniques: string[][];
  foreignKeys: ForeignKey[];
  /** Plain CREATE INDEX statements: the ones a reader can choose to keep or drop. */
  indexes: string[][];
}

export interface Schema {
  tables: Table[];
}

const IDENT = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[\w$]+)`;
const QIDENT = String.raw`(?:${IDENT}\.)*${IDENT}`;

/** `"Public"."Parcel"` and `public.parcel` both name the table `parcel`. */
function name(raw: string): string {
  const last = raw.trim().split('.').pop() ?? '';
  return last.replace(/^["`[]|["`\]]$/g, '').toLowerCase();
}

/** Split on `separator` where it is outside parentheses and quotes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The text between the first `(` and its matching `)`. */
function parenthesised(text: string): string | null {
  const open = text.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const columnList = (list: string): string[] =>
  splitTopLevel(list, ',')
    .map((item) => item.match(new RegExp(`^(${IDENT})`))?.[1])
    .filter((item): item is string => item !== undefined)
    .map(name);

function deleteAction(text: string): DeleteAction {
  const found = text.match(/\bon\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i);
  return (found?.[1]?.toLowerCase().replace(/\s+/g, ' ') as DeleteAction | undefined) ?? 'no action';
}

const CONSTRAINT = String.raw`^(?:constraint\s+${IDENT}\s+)?`;

/** A table-level constraint, added to `table`. Returns false when it is not one this reader keeps. */
function addConstraint(table: Table, text: string): boolean {
  const primary = text.match(new RegExp(`${CONSTRAINT}primary\\s+key\\s*\\(([^)]*)\\)`, 'i'));
  if (primary) {
    table.primaryKey = columnList(primary[1]!);
    return true;
  }
  const unique = text.match(new RegExp(`${CONSTRAINT}unique\\b[^(]*\\(([^)]*)\\)`, 'i'));
  if (unique) {
    table.uniques.push(columnList(unique[1]!));
    return true;
  }
  const foreign = text.match(
    new RegExp(
      `${CONSTRAINT}foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+(${QIDENT})\\s*(?:\\(([^)]*)\\))?([\\s\\S]*)$`,
      'i',
    ),
  );
  if (foreign) {
    table.foreignKeys.push({
      columns: columnList(foreign[1]!),
      refTable: name(foreign[2]!),
      refColumns: foreign[3] ? columnList(foreign[3]) : [],
      onDelete: deleteAction(foreign[4] ?? ''),
    });
    return true;
  }
  return false;
}

const TYPE_END =
  /^(.*?)(?:\s+(?:not\s+null|null|primary|unique|references|default|check|constraint|generated|collate|auto_?increment|identity)\b.*)?$/is;

function addColumn(table: Table, text: string): void {
  const head = text.match(new RegExp(`^(${IDENT})\\s*([\\s\\S]*)$`));
  if (!head) return;
  const column = name(head[1]!);
  const rest = head[2]!;
  const primary = /\bprimary\s+key\b/i.test(rest);
  table.columns.push({
    name: column,
    type: (rest.match(TYPE_END)?.[1] ?? '').trim().toLowerCase(),
    notNull: primary || /\bnot\s+null\b/i.test(rest),
  });
  if (primary) table.primaryKey = [column];
  if (/\bunique\b/i.test(rest)) table.uniques.push([column]);
  const reference = rest.match(
    new RegExp(`\\breferences\\s+(${QIDENT})\\s*(?:\\(\\s*(${IDENT})\\s*\\))?`, 'i'),
  );
  if (reference) {
    table.foreignKeys.push({
      columns: [column],
      refTable: name(reference[1]!),
      refColumns: reference[2] ? [name(reference[2])] : [],
      onDelete: deleteAction(rest),
    });
  }
}

function createTable(statement: string): Table | null {
  const head = statement.match(
    new RegExp(`^create\\s+(?:(?:temp|temporary|unlogged|global)\\s+)*table\\s+(?:if\\s+not\\s+exists\\s+)?(${QIDENT})`, 'i'),
  );
  const body = parenthesised(statement);
  if (!head || body === null) return null;
  const table: Table = {
    name: name(head[1]!),
    columns: [],
    primaryKey: [],
    uniques: [],
    foreignKeys: [],
    indexes: [],
  };
  for (const item of splitTopLevel(body, ',')) {
    if (addConstraint(table, item)) continue;
    if (new RegExp(`${CONSTRAINT}(check|exclude)\\b|^like\\b`, 'i').test(item)) continue;
    addColumn(table, item);
  }
  // A primary key column is never null, even when the key was declared as a table constraint.
  for (const column of table.columns) {
    if (table.primaryKey.includes(column.name)) column.notNull = true;
  }
  return table;
}

/** Read every table, index and added foreign key from `sql`. */
export function parseDdl(sql: string): Schema {
  const text = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const statements = splitTopLevel(text, ';');
  const tables = new Map<string, Table>();

  for (const statement of statements) {
    const table = createTable(statement);
    if (table) tables.set(table.name, table);
  }
  for (const statement of statements) {
    const alter = statement.match(
      new RegExp(`^alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QIDENT})\\s+add\\s+([\\s\\S]*)$`, 'i'),
    );
    const target = alter && tables.get(name(alter[1]!));
    if (alter && target) addConstraint(target, alter[2]!);

    const index = statement.match(
      new RegExp(
        `^create\\s+(unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:${IDENT}\\s+)?on\\s+(?:only\\s+)?(${QIDENT})\\s*(?:using\\s+\\w+\\s*)?\\(`,
        'i',
      ),
    );
    const indexed = index && tables.get(name(index[2]!));
    const list = index && parenthesised(statement.slice(index[0].length - 1));
    // An index on an expression, such as lower(email), does not serve a foreign key lookup.
    if (index && indexed && list && !list.includes('(')) {
      (index[1] ? indexed.uniques : indexed.indexes).push(columnList(list));
    }
  }
  // REFERENCES parent with no column list means the parent's primary key.
  for (const table of tables.values()) {
    for (const key of table.foreignKeys) {
      if (key.refColumns.length === 0) key.refColumns = [...(tables.get(key.refTable)?.primaryKey ?? [])];
    }
  }
  return { tables: [...tables.values()] };
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  sql: string;
}

const MARKER = /^[ \t]*--[ \t]*scenario:[ \t]*(.*)$/gim;

/**
 * Split a widget block's SQL into scenarios. Each starts with a comment line
 * `-- scenario: Title | one-line blurb`, so the whole block stays valid SQL. With no marker the
 * whole text is one scenario.
 */
export function parseScenarios(source: string): Scenario[] {
  const marks = [...source.matchAll(MARKER)];
  if (marks.length === 0) return [{ id: 's0', title: 'Schema', blurb: '', sql: source.trim() }];
  return marks.map((mark, index) => {
    const [title = '', blurb = ''] = mark[1]!.split('|').map((part) => part.trim());
    const end = marks[index + 1]?.index ?? source.length;
    const sql = source.slice(mark.index + mark[0].length, end).trim();
    return { id: `s${index}`, title: title || `Scenario ${index + 1}`, blurb, sql };
  });
}
