/**
 * Micro-world: several CSS rules that all match one element and set the same property, and the
 * cascade that picks the winner. The reader edits selectors and flags and watches the order of
 * precedence change. The point is the order of the tie-breakers (importance, inline style,
 * layers, specificity, source order) and that specificity counts in columns, not as one number.
 *
 * Rules come from the concept's block, one per line: `selector | colour | flags`, where flags
 * are any of `!important`, `inline`, `layer=N`. With no data, the presets supply the rules.
 */

import { useState } from 'react';
import { Facts, ModelNote, Note, Presets, SourceProblem, useWorld, type WorldPreset } from '../kit.tsx';
import { cells, dataLines, SourceError } from '../models/source.ts';
import {
  cascade,
  formatSpecificity,
  parseSelector,
  type Declaration,
  type PartKind,
  type Reason,
} from '../models/specificity.ts';

const COLOURS = ['crimson', 'royalblue', 'seagreen', 'darkorange', 'rebeccapurple'] as const;

interface Rule {
  key: number;
  selector: string;
  colour: string;
  important: boolean;
  inline: boolean;
  /** 0 means not in a layer. */
  layer: number;
}

interface State {
  rules: Rule[];
}

const rule = (
  key: number,
  selector: string,
  colour: string,
  extra: Partial<Rule> = {},
): Rule => ({ key, selector, colour, important: false, inline: false, layer: 0, ...extra });

const PRESETS: readonly WorldPreset<State>[] = [
  {
    id: 'columns',
    label: 'Ten classes against one id',
    state: {
      rules: [
        rule(1, '.status.delivered.badge.large.bold.rounded.pill.on-time.shadow.soft', 'seagreen'),
        rule(2, '#status', 'crimson'),
      ],
    },
    note: 'The ten classes come to (0, 10, 0) and the id to (1, 0, 0). Specificity compares column by column, left to right, so one id beats any number of classes. It is not a number in base ten that carries.',
  },
  {
    id: 'order',
    label: 'A tie: the later rule wins',
    state: { rules: [rule(1, '.badge', 'royalblue'), rule(2, '.badge', 'darkorange')] },
    note: 'Same specificity, so source order decides, and the stylesheet that loads last wins. This is why reordering <link> tags can change a page.',
  },
  {
    id: 'important',
    label: '!important beats an id',
    state: {
      rules: [
        rule(1, '#status', 'seagreen'),
        rule(2, '.badge', 'crimson', { important: true }),
      ],
    },
    note: '!important is checked before specificity is even looked at. Only another !important can beat it, and between two of those the usual tie-breakers apply again (inline, layer, specificity, order), which is how override wars start.',
  },
  {
    id: 'inline',
    label: 'Inline style',
    state: {
      rules: [
        rule(1, '#status', 'royalblue'),
        rule(2, '', 'crimson', { inline: true }),
        rule(3, 'html body #status', 'seagreen'),
      ],
    },
    note: 'A style="" attribute sits above every selector, so no id can outrank it. Only !important can.',
  },
  {
    id: 'layers',
    label: 'Cascade layers',
    state: {
      rules: [
        rule(1, '#status', 'rebeccapurple', { layer: 1 }),
        rule(2, '.badge', 'darkorange'),
      ],
    },
    note: 'The id is in an @layer and the class is not. Layers are checked before specificity, and unlayered rules beat layered ones, so the weaker selector wins. This is how a framework put in a layer stays easy to override. Add !important to both and the order reverses.',
  },
  {
    id: 'where',
    label: ':is() against :where()',
    state: {
      rules: [
        rule(1, ':is(#status, .big) a', 'royalblue'),
        rule(2, ':where(#status) a.link', 'crimson'),
      ],
    },
    note: ':is() takes the specificity of its most specific argument, here the id, even when the element matches the other one. :where() counts as zero, which makes it the tool for defaults that are easy to override.',
  },
];

const REASONS: Record<Reason, string> = {
  important: 'lost to an !important rule',
  inline: 'lost to the inline style',
  layer: 'lost on cascade layer',
  specificity: 'lost on specificity',
  order: 'lost on source order',
};

/** Read `selector | colour | flags` lines into rules. An unknown flag is an error, not ignored. */
function parseRules(source: string): Rule[] {
  return dataLines(source).map((line, index) => {
    const [selector = '', colour = '', flags = '', ...extra] = cells(line);
    if (!colour || extra.length > 0) {
      throw new SourceError(index + 1, `expected "selector | colour [| flags]", got "${line}"`);
    }
    let layer = 0;
    const words = flags.split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (word === '!important' || word === 'inline') continue;
      const rank = /^layer=(\d+)$/.exec(word);
      if (rank && Number(rank[1]) >= 1) layer = Number(rank[1]);
      else {
        throw new SourceError(index + 1, `unknown flag "${word}": use !important, inline or layer=N (N from 1, later layers win)`);
      }
    }
    return rule(index + 1, selector, colour, {
      important: words.includes('!important'),
      inline: words.includes('inline'),
      layer,
    });
  });
}

const kindClass: Record<PartKind, string> = {
  id: 'okfw-css-id',
  class: 'okfw-css-class',
  type: 'okfw-css-type',
  zero: 'okfw-css-zero',
};

export default function CssSpecificity({ source }: { source: string }) {
  let given: Rule[] = [];
  let problem: unknown = null;
  try {
    given = parseRules(source);
  } catch (error) {
    problem = error;
  }
  const presets: readonly WorldPreset<State>[] =
    given.length > 0
      ? [
          {
            id: 'given',
            label: 'As written in the page',
            state: { rules: given },
            note: 'The rules this page gives. Edit any of them.',
          },
          ...PRESETS,
        ]
      : PRESETS;
  const world = useWorld(presets);
  const [nextKey, setNextKey] = useState(100);
  if (problem) return <SourceProblem error={problem} />;

  const { rules } = world.state;
  const update = (key: number, patch: Partial<Rule>) =>
    world.set({ rules: rules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  // A rule whose selector cannot be read is shown with its problem and left out of the cascade.
  const errors = new Map<number, string>();
  const declarations: Declaration[] = [];
  for (const r of rules) {
    if (!r.inline) {
      try {
        parseSelector(r.selector);
      } catch (error) {
        errors.set(r.key, error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    declarations.push({
      id: String(r.key),
      selector: r.selector,
      value: r.colour,
      important: r.important,
      inline: r.inline,
      layer: r.layer === 0 ? null : r.layer,
    });
  }
  const ranked = cascade(declarations);
  const winner = ranked[0];

  return (
    <div>
      <Presets presets={presets} active={world.preset?.id ?? null} probe="important" onChoose={world.choose} />
      <p className="okfw-muted">
        Every rule below matches the same element, say <code>&lt;a id="status" class="badge link big"&gt;</code>,
        and sets its <code>color</code>.
      </p>

      <div className="okfw-rules">
        {rules.map((r, index) => (
          <div className="okfw-rule" key={r.key}>
            <input
              type="text"
              className="okfw-selector"
              aria-label={`Selector ${index + 1}`}
              value={r.inline ? 'style="…"' : r.selector}
              disabled={r.inline}
              spellCheck={false}
              onChange={(event) => update(r.key, { selector: event.target.value })}
            />
            <select
              aria-label={`Colour ${index + 1}`}
              value={r.colour}
              onChange={(event) => update(r.key, { colour: event.target.value })}
              style={{ borderLeft: `8px solid ${r.colour}` }}
            >
              {[...new Set([...COLOURS, r.colour])].map((colour) => (
                <option key={colour} value={colour}>
                  {colour}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                aria-label={`!important ${index + 1}`}
                checked={r.important}
                onChange={(event) => update(r.key, { important: event.target.checked })}
              />{' '}
              !important
            </label>
            <label>
              <input
                type="checkbox"
                aria-label={`Inline ${index + 1}`}
                checked={r.inline}
                onChange={(event) => update(r.key, { inline: event.target.checked })}
              />{' '}
              inline
            </label>
            <label>
              layer{' '}
              <select
                aria-label={`Layer ${index + 1}`}
                value={r.layer}
                onChange={(event) => update(r.key, { layer: Number(event.target.value) })}
              >
                <option value={0}>none</option>
                {[...new Set([1, 2, 3, r.layer])]
                  .filter((rank) => rank > 0)
                  .sort((a, b) => a - b)
                  .map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                      {rank === 1 ? ' (early)' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() => world.set({ rules: rules.filter((other) => other.key !== r.key) })}
            >
              Remove
            </button>
            {errors.has(r.key) && <span className="okfw-rule-error">{errors.get(r.key)}</span>}
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            world.set({ rules: [...rules, rule(nextKey, '.badge', 'royalblue')] });
            setNextKey(nextKey + 1);
          }}
        >
          Add a rule
        </button>
      </div>

      <h4>Strongest first</h4>
      <ol className="okfw-plain okfw-ranked" data-testid="css-ranked">
        {ranked.map((entry, index) => (
          <li key={entry.declaration.id} data-winner={index === 0}>
            <span className="okfw-swatch" style={{ background: entry.declaration.value }} aria-hidden="true" />
            <code className="okfw-css-selector">
              {entry.declaration.inline
                ? 'style="…"'
                : entry.parts.map((part, at) => (
                    <span key={at} className={kindClass[part.kind]}>
                      {part.text}
                    </span>
                  ))}
            </code>
            <span className="okfw-spec">
              {entry.declaration.inline ? 'inline' : formatSpecificity(entry.specificity)}
              {entry.declaration.important && ' !important'}
              {entry.declaration.layer != null && ` layer ${entry.declaration.layer}`}
            </span>
            <span className="okfw-muted">
              {index === 0 ? 'wins' : entry.lostOn ? REASONS[entry.lostOn] : ''}
            </span>
          </li>
        ))}
      </ol>
      <p className="okfw-reason">
        Specificity reads (ids, classes, types):{' '}
        <span className="okfw-css-id">ids</span> <span className="okfw-css-class">classes, attributes, :pseudo-classes</span>{' '}
        <span className="okfw-css-type">element types, ::pseudo-elements</span>
      </p>

      <Facts
        testId="css-result"
        rows={[
          [
            'The element is',
            winner ? (
              <>
                <span className="okfw-swatch" style={{ background: winner.declaration.value }} aria-hidden="true" />{' '}
                <strong>{winner.declaration.value}</strong>
              </>
            ) : (
              'unstyled: no rule applies'
            ),
          ],
        ]}
      />
      {world.preset && <Note>{world.preset.note}</Note>}
      <ModelNote>
        A model: <code>models/specificity.ts</code>, checked against the examples in the Selectors
        specification. It assumes every rule matches the element; it does not match selectors
        against a document, and does not model origins (user agent, user) or <code>@scope</code>.
      </ModelNote>
    </div>
  );
}
