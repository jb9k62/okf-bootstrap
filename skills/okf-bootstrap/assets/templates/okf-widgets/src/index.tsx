/**
 * The widget bundle's entry. Built as one IIFE that exposes `window.OkfWidgets`, which
 * scripts/okf-view.mts calls for every ```widget block in a concept:
 *
 *   mount(element, name, source)
 *                         render widget `name` into `element`; false for an unknown name. `source`
 *                         is whatever follows the name in the ```widget block (empty for most
 *                         widgets); a widget that takes data, like sql-erd, reads it.
 *   unmountAll()          called before the viewer replaces the reading pane
 *   names                 the registered names, listed in the viewer's "unknown widget" error
 *
 * To add a widget: write it in src/widgets/, put any logic it teaches in a pure, tested module
 * in src/models/ (or import the project's own through @app), and register it below.
 */

import {
  Component,
  StrictMode,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import styles from './widgets.css?inline';
import BinarySearch from './widgets/BinarySearch.tsx';
import BloomFilter from './widgets/BloomFilter.tsx';
import CachePolicy from './widgets/CachePolicy.tsx';
import ConsistentHash from './widgets/ConsistentHash.tsx';
import CssSpecificity from './widgets/CssSpecificity.tsx';
import HttpConcurrency from './widgets/HttpConcurrency.tsx';
import RateLimiter from './widgets/RateLimiter.tsx';
import RetryBackoff from './widgets/RetryBackoff.tsx';
import SqlErd from './widgets/SqlErd.tsx';
import UtcWeek from './widgets/UtcWeek.tsx';

/** Every widget receives the text after its name in the block, which most ignore. */
export interface WidgetProps {
  source: string;
}

/** The name is what a concept writes in its ```widget block; the title is the caption. */
export const WIDGETS: Readonly<
  Record<string, { title: string; component: ComponentType<WidgetProps> }>
> = {
  'utc-week': { title: 'Try it: which week is this instant in?', component: UtcWeek },
  'retry-backoff': {
    title: 'Try it: retries, backoff and jitter',
    component: RetryBackoff,
  },
  'sql-erd': {
    title: 'Try it: explore this schema',
    component: SqlErd,
  },
  'cache-policy': {
    title: 'Try it: what does the cache keep?',
    component: CachePolicy,
  },
  'http-concurrency': {
    title: 'Try it: how many requests at once?',
    component: HttpConcurrency,
  },
  'css-specificity': {
    title: 'Try it: which rule wins?',
    component: CssSpecificity,
  },
  'rate-limiter': {
    title: 'Try it: who gets through the limiter?',
    component: RateLimiter,
  },
  'binary-search': {
    title: 'Try it: how many looks does it take?',
    component: BinarySearch,
  },
  'consistent-hash': {
    title: 'Try it: which server holds this key?',
    component: ConsistentHash,
  },
  'bloom-filter': {
    title: 'Try it: a set that forgets what it holds',
    component: BloomFilter,
  },
};

class Boundary extends Component<
  { children: ReactNode },
  { failed: string | null }
> {
  state = { failed: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.failed !== null) {
      return (
        <p className="okfw-error">
          This widget failed to render: {this.state.failed}
        </p>
      );
    }
    return this.props.children;
  }
}

const roots = new Set<Root>();

function injectStyles() {
  if (document.getElementById('okfw-styles')) return;
  const style = document.createElement('style');
  style.id = 'okfw-styles';
  style.textContent = styles;
  document.head.append(style);
}

/** Render widget `name` into `element`. Returns false for an unknown name. */
export function mount(element: HTMLElement, name: string, source = ''): boolean {
  const widget = WIDGETS[name];
  if (!widget) return false;
  injectStyles();
  const root = createRoot(element);
  const Widget = widget.component;
  root.render(
    <StrictMode>
      <figure className="okfw" data-widget={name}>
        <figcaption>{widget.title}</figcaption>
        <Boundary>
          <Widget source={source} />
        </Boundary>
      </figure>
    </StrictMode>,
  );
  roots.add(root);
  return true;
}

/** Unmount every widget, before the viewer replaces the reading pane. */
export function unmountAll(): void {
  for (const root of roots) root.unmount();
  roots.clear();
}

export const names = Object.keys(WIDGETS);
