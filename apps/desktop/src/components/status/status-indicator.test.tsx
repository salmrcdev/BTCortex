import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusIndicator } from './status-indicator';

describe('StatusIndicator', () => {
  it('always renders a text label next to the icon', () => {
    render(<StatusIndicator tone="failed" label="Unreachable" />);
    const label = screen.getByText('Unreachable');
    expect(label).toBeDefined();
    const container = label.parentElement;
    expect(container?.getAttribute('data-tone')).toBe('failed');
    expect(container?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
