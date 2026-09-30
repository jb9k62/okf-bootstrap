/**
 * The shared pieces of a micro-world, so every widget in a project reads the same way. The
 * example widgets use all of them; a new widget should too.
 */

import type { ReactNode } from 'react';

export interface PresetOption {
  id: string;
  label: string;
}

/**
 * Buttons that jump to the cases worth seeing. Mark exactly one as `probe`: the viewer's render
 * gate clicks it and fails the build if the widget's text does not change.
 */
export function Presets<T extends PresetOption>({
  presets,
  active,
  probe,
  onChoose,
}: {
  presets: readonly T[];
  active: string | null;
  probe: string;
  onChoose: (preset: T) => void;
}) {
  return (
    <div className="okfw-presets" role="group" aria-label="Presets">
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-pressed={preset.id === active}
          data-probe={preset.id === probe || undefined}
          onClick={() => onChoose(preset)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

/** The widget's result as label/value rows. */
export function Facts({
  rows,
  testId,
}: {
  rows: ReadonlyArray<readonly [label: ReactNode, value: ReactNode]>;
  testId?: string;
}) {
  return (
    <dl className="okfw-facts" data-testid={testId}>
      {rows.map(([label, value], index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Explanation of the active preset, or a warning when the reader breaks an invariant. */
export function Note({ tone = 'note', children }: { tone?: 'note' | 'warn'; children: ReactNode }) {
  return tone === 'warn' ? (
    <p className="okfw-warn" role="status">
      {children}
    </p>
  ) : (
    <p className="okfw-note">{children}</p>
  );
}

/**
 * The honesty line every widget ends with: which parts run the project's real code and which
 * are a model of it. A reader who cannot tell the two apart cannot trust either.
 */
export function ModelNote({ children }: { children: ReactNode }) {
  return <p className="okfw-model">{children}</p>;
}
