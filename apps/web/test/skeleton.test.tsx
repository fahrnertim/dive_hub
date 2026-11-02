// Skeleton (spec "Loading: skeletons"): nothing for the first 150 ms, then flat bars; one hidden "Loading…" for
// screen readers.
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Skeleton, SkeletonLine } from '../src/ui/Skeleton.tsx';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Skeleton', () => {
  it('shows no bars right after render, then bars once 150 ms have passed', () => {
    const { container } = render(<Skeleton><SkeletonLine width="60%" /></Skeleton>);
    expect(container.querySelector('.skeleton-bar')).toBeNull();
    act(() => { vi.advanceTimersByTime(149); });
    expect(container.querySelector('.skeleton-bar')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(container.querySelector('.skeleton-bar')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('says "Loading…" once, however many bars there are', () => {
    render(<Skeleton><SkeletonLine width="60%" /><SkeletonLine width="40%" /></Skeleton>);
    act(() => { vi.advanceTimersByTime(150); });
    expect(screen.getAllByText('Loading…')).toHaveLength(1);
  });

  it('takes the hidden text from a label', () => {
    render(<Skeleton label="Loading the dive…"><SkeletonLine width="60%" /></Skeleton>);
    expect(screen.getByText('Loading the dive…')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});
