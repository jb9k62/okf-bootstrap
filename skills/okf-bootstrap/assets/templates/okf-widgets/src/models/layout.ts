/**
 * Places each table as a box, parents to the left of their children, so a foreign key reads
 * left to right. Pure geometry: the widget draws whatever this returns.
 */

import type { Schema } from './ddl.ts';
import { relations } from './schema.ts';

export const BOX = { width: 208, header: 28, row: 19, pad: 6, gapX: 84, gapY: 28, margin: 14 } as const;

export interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The y of each column's row, for anchoring a relationship line on its column. */
  rows: Record<string, number>;
}

export interface Layout {
  boxes: Record<string, Box>;
  width: number;
  height: number;
}

const heightOf = (columns: number) => BOX.header + columns * BOX.row + BOX.pad;

export function layout(schema: Schema): Layout {
  const all = relations(schema).filter((relation) => relation.child !== relation.parent);
  const names = schema.tables.map((table) => table.name);

  // A table sits one rank to the right of the furthest parent. The pass count bounds a cycle.
  const rank = new Map(names.map((name) => [name, 0]));
  for (let pass = 0; pass < names.length; pass++) {
    for (const relation of all) {
      const next = Math.min(rank.get(relation.parent)! + 1, names.length - 1);
      if (next > rank.get(relation.child)!) rank.set(relation.child, next);
    }
  }

  const columns: string[][] = [];
  for (const name of names) (columns[rank.get(name)!] ??= []).push(name);
  // Order each column by where its parents sit, which removes most crossings.
  const order = new Map<string, number>();
  columns.forEach((column, index) => {
    if (index > 0) {
      const mean = (name: string) => {
        const parents = all.filter((r) => r.child === name).map((r) => order.get(r.parent) ?? 0);
        return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Infinity;
      };
      column.sort((a, b) => mean(a) - mean(b));
    }
    column.forEach((name, row) => order.set(name, row));
  });

  const tall = Math.max(
    0,
    ...columns.map((column) =>
      column.reduce((sum, name) => sum + heightOf(schema.tables.find((t) => t.name === name)!.columns.length) + BOX.gapY, -BOX.gapY),
    ),
  );
  const boxes: Record<string, Box> = {};
  columns.forEach((column, index) => {
    const used = column.reduce(
      (sum, name) => sum + heightOf(schema.tables.find((t) => t.name === name)!.columns.length) + BOX.gapY,
      -BOX.gapY,
    );
    let y = BOX.margin + (tall - used) / 2;
    for (const name of column) {
      const table = schema.tables.find((t) => t.name === name)!;
      const height = heightOf(table.columns.length);
      boxes[name] = {
        name,
        x: BOX.margin + index * (BOX.width + BOX.gapX),
        y,
        width: BOX.width,
        height,
        rows: Object.fromEntries(
          table.columns.map((column, row) => [column.name, y + BOX.header + row * BOX.row + BOX.row / 2]),
        ),
      };
      y += height + BOX.gapY;
    }
  });
  return {
    boxes,
    width: BOX.margin * 2 + columns.length * BOX.width + Math.max(0, columns.length - 1) * BOX.gapX,
    height: BOX.margin * 2 + tall,
  };
}
