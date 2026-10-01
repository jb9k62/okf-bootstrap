import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import RetryBackoff from './RetryBackoff.tsx';
import SqlErd from './SqlErd.tsx';
import UtcWeek from './UtcWeek.tsx';

// One test per widget for the interaction it exists to teach. The models have their own tests.
describe('UtcWeek', () => {
  it('files Monday 00:30 in Johannesburg under the previous week, then moves with a preset', async () => {
    render(<UtcWeek />);
    expect(screen.getByTestId('week-label')).toHaveTextContent('Mon 14 Sep to Sun 20 Sep');
    await userEvent.click(screen.getByRole('button', { name: 'New Year in Auckland' }));
    expect(screen.getByTestId('week-label')).toHaveTextContent('Mon 28 Dec to Sun 3 Jan');
  });
});

describe('RetryBackoff', () => {
  it('shows the herd without jitter, and a far lower peak with it', async () => {
    render(<RetryBackoff />);
    const result = screen.getByTestId('backoff-result');
    expect(result).toHaveTextContent('100 retries at once');
    expect(screen.getByRole('status')).toHaveTextContent('lockstep');
    await userEvent.click(screen.getByRole('checkbox', { name: /Full jitter/ }));
    expect(result).not.toHaveTextContent('100 retries at once');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bounds the longest delay with the cap', async () => {
    render(<RetryBackoff />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Retries' }), {
      target: { value: '8' },
    });
    expect(screen.getByText('retry 8: 64.0 s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Cap each delay/ }));
    expect(screen.getByText('retry 8: 2.0 s')).toBeInTheDocument();
  });
});

// The widget takes its SQL from the concept's block, so the tests pass it the same way.
const SHOP = `
-- scenario: Shop | A customer places orders
CREATE TABLE customer (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE "order" (
  id int PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
  note_1 text, note_2 text
);
CREATE INDEX order_by_customer ON "order" (customer_id);
-- scenario: Marketplace | Sellers, listings and order lines
CREATE TABLE customer (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE seller (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE "order" (id int PRIMARY KEY, customer_id int NOT NULL REFERENCES customer (id));
CREATE TABLE listing (id int PRIMARY KEY, seller_id int NOT NULL REFERENCES seller (id), price numeric(10, 2) NOT NULL);
CREATE TABLE line (
  order_id int NOT NULL REFERENCES "order" (id),
  listing_id int NOT NULL REFERENCES listing (id),
  PRIMARY KEY (order_id, listing_id)
);
`;

describe('SqlErd', () => {
  it('draws the tables and shows what the larger scenario adds', async () => {
    render(<SqlErd source={SHOP} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/2 tables and 1 relationships/);
    expect(screen.queryByText('NEW')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Marketplace' }));
    expect(screen.getByRole('img')).toHaveAccessibleName(/5 tables and 4 relationships/);
    expect(screen.getAllByText('NEW')).toHaveLength(3);
    expect(screen.getByText(/3 not in Shop/)).toBeInTheDocument();
  });

  it('reviews the design, and loses checks when the reader removes the foreign keys', async () => {
    render(<SqlErd source={SHOP} />);
    const health = screen.getByTestId('erd-health');
    expect(health).toHaveTextContent('5 of 6');
    expect(screen.getByRole('button', { name: /Numbered columns that repeat/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Declare the foreign keys/ }));
    expect(screen.getByRole('button', { name: /look like foreign keys but are not declared/ })).toBeInTheDocument();
    expect(health).not.toHaveTextContent('5 of 6');
  });

  it('flags foreign keys with no index when the reader drops the CREATE INDEX statements', async () => {
    render(<SqlErd source={SHOP} />);
    expect(screen.getByRole('button', { name: 'Every foreign key is indexed' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Keep the CREATE INDEX/ }));
    expect(screen.getByRole('button', { name: 'Foreign keys with no index' })).toBeInTheDocument();
  });

  it('writes the join between two tables, and follows the picks', async () => {
    render(<SqlErd source={SHOP} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Join path' }));
    expect(screen.getByTestId('erd-join')).toHaveTextContent('JOIN order ON order.customer_id = customer.id');
    await userEvent.selectOptions(screen.getByLabelText('From'), 'order');
    await userEvent.selectOptions(screen.getByLabelText('to'), 'customer');
    expect(screen.getByTestId('erd-join')).toHaveTextContent(/FROM order\s+JOIN customer ON order\.customer_id = customer\.id/);
    expect(screen.getByText(/never: every hop goes from a child/)).toBeInTheDocument();
  });

  it('shows the cascade, and the refusal once the cascade is removed', async () => {
    render(<SqlErd source={SHOP} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Delete impact' }));
    const effects = screen.getByTestId('erd-delete');
    expect(effects).toHaveTextContent('rows in order is deleted too');
    await userEvent.click(screen.getByRole('tab', { name: 'Edit the SQL' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Schema SQL' }), {
      target: { value: 'CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (id int PRIMARY KEY, a_id int NOT NULL REFERENCES a (id));' },
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Delete impact' }));
    expect(screen.getByTestId('erd-delete')).toHaveTextContent('refuses the delete');
    expect(screen.getByRole('status')).toHaveTextContent('Refused');
  });

  it('takes a click on a table as the ends of the join, alternately', async () => {
    render(<SqlErd source={SHOP} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Join path' }));
    await userEvent.click(screen.getByRole('button', { name: 'Table order' }));
    expect(screen.getByLabelText('From')).toHaveValue('order');
    await userEvent.click(screen.getByRole('button', { name: 'Table customer' }));
    expect(screen.getByLabelText('to')).toHaveValue('customer');
  });

  it('expands the diagram over the window, and closes it with Escape', async () => {
    render(<SqlErd source={SHOP} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('button', { name: /Close/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
  });

  it('shows a sample when the block has no SQL, and a warning for SQL with no table', () => {
    const { unmount } = render(<SqlErd source="" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/3 tables/);
    unmount();
    render(<SqlErd source="SELECT 1;" />);
    expect(screen.getByRole('status')).toHaveTextContent('No CREATE TABLE statement found');
  });
});
