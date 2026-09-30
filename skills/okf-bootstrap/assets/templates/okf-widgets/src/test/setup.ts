// Adds the jest-dom matchers to Vitest's expect, for example
// expect(element).toBeInTheDocument().
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  // Vitest does not expose the global afterEach that Testing Library
  // auto-cleanup looks for, so unmount explicitly between tests.
  cleanup();
});
