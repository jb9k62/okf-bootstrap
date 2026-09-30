import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import RetryBackoff from './RetryBackoff.tsx';
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
