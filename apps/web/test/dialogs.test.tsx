// Dialogs (UI review B2, B3): a ConfirmButton asks before a hard-to-undo action and gives focus back to itself; a
// failed action keeps the dialog open with its error; a form's Cancel asks only when something would be lost.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CancelButton, ConfirmButton } from '../src/ui/Overlay.tsx';

const revoke = (onConfirm: () => Promise<unknown>) => (
  <ConfirmButton title="Revoke the access?" body="The AI client can no longer read the logbook." confirmLabel="Revoke" onConfirm={onConfirm}>
    Revoke access
  </ConfirmButton>
);

describe('ConfirmButton', () => {
  it('runs the action only once confirmed, then closes and gives focus back to the button', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => {});
    render(revoke(onConfirm));
    const opener = screen.getByRole('button', { name: 'Revoke access' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Revoke the access?' })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    // React Aria gives focus back in the next frame.
    await waitFor(() => { expect(document.activeElement).toBe(opener); });
  });

  it('closes on Cancel without the action', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => {});
    render(revoke(onConfirm));
    await user.click(screen.getByRole('button', { name: 'Revoke access' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays open with the error when the action fails', async () => {
    const user = userEvent.setup();
    render(revoke(async () => { throw new Error('boom'); }));
    await user.click(screen.getByRole('button', { name: 'Revoke access' }));
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('CancelButton', () => {
  it('cancels at once when nothing is unsaved', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<CancelButton unsaved={false} lost="The new site is lost." onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks first with unsaved changes: Keep editing stays, Discard changes cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<CancelButton unsaved lost="The new site is lost." onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Leave without saving?' }).textContent).toContain('The new site is lost.');

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => { expect(onCancel).toHaveBeenCalledOnce(); });
  });
});
