/**
 * The shared pieces of a micro-world, so every widget in a project reads the same way. The
 * example widgets use all of them; a new widget should too.
 */

import { useState, type ReactNode } from 'react';

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

/** A preset that carries the whole state it jumps to, and the note that explains it. */
export interface WorldPreset<S> extends PresetOption {
  state: S;
  note: ReactNode;
}

/**
 * The state of a micro-world: one object, the preset that produced it (if the reader has not
 * touched anything since), and `set` for direct control. Editing anything clears the active
 * preset, so its note never describes a state the reader has left. Keep the state minimal and
 * derive everything else from the model on each render.
 */
export function useWorld<S extends object>(presets: readonly WorldPreset<S>[], initial = 0) {
  const first = presets[initial]!;
  const [state, setState] = useState<S>(first.state);
  const [presetId, setPresetId] = useState<string | null>(first.id);
  return {
    state,
    preset: presets.find((candidate) => candidate.id === presetId) ?? null,
    set(patch: Partial<S>) {
      setState((current) => ({ ...current, ...patch }));
      setPresetId(null);
    },
    choose(preset: WorldPreset<S>) {
      setState(preset.state);
      setPresetId(preset.id);
    },
  };
}

/** A labelled range input. The label is the accessible name; `format` shapes the value shown. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="okfw-row">
      {label}{' '}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />{' '}
      {format(value)}
    </label>
  );
}

/** A checkbox with an optional one-line reason beneath it. */
export function Toggle({
  label,
  reason,
  checked,
  onChange,
}: {
  label: ReactNode;
  reason?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="okfw-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{' '}
      {label}
      {reason && <span className="okfw-reason">{reason}</span>}
    </label>
  );
}

/** A minimal histogram, one bar per value, scaled to the largest. Decorative: say it in text too. */
export function BarChart({ values, label }: { values: readonly number[]; label?: string }) {
  const peak = Math.max(0, ...values);
  return (
    <div className="okfw-bars" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {values.map((value, index) => (
        <span key={index} style={{ height: `${peak ? (value / peak) * 100 : 0}%` }} />
      ))}
    </div>
  );
}

/**
 * Shown instead of the widget when the data a concept gave it cannot be read. Say which line,
 * and what was expected: the author is about to fix it, and a silent fallback would hide it.
 */
export function SourceProblem({ error }: { error: unknown }) {
  return (
    <p className="okfw-error">
      Could not read this widget's data: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** One of several exclusive options, as a row of buttons (a policy, a mode). No probe: see Presets. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="okfw-presets" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Step through a sequence one item at a time (requests, comparisons, frames). The slider and the
 * two buttons all move the same position; `value` is 0-based and `max` is the last position.
 */
export function Scrubber({
  label,
  value,
  max,
  onChange,
  describe,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  describe?: (value: number) => ReactNode;
}) {
  const clamped = Math.min(Math.max(value, 0), Math.max(max, 0));
  return (
    <div className="okfw-scrubber">
      <button type="button" aria-label={`${label}: previous`} disabled={clamped <= 0} onClick={() => onChange(clamped - 1)}>
        ◀
      </button>
      <input
        type="range"
        aria-label={label}
        min={0}
        max={Math.max(max, 0)}
        value={clamped}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button type="button" aria-label={`${label}: next`} disabled={clamped >= max} onClick={() => onChange(clamped + 1)}>
        ▶
      </button>
      <span className="okfw-scrubber-text">{describe ? describe(clamped) : `${clamped + 1} of ${max + 1}`}</span>
    </div>
  );
}
