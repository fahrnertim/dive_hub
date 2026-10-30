// An inline form as the pages build one (UI review B1, B3): Form and TextField check required fields on submit in our
// words, useLeaveGuard asks before leaving with unsaved text until the form saved, and useFocusBackWhenClosed gives
// focus back to the button that opened it.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusBackWhenClosed } from '../src/lib/focus.ts';
import { mayLeave, useLeaveGuard } from '../src/lib/leave-guard.ts';
import { Button, Form, TextField } from '../src/ui/index.ts';

function NoteForm({ onSave }: { onSave: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const opener = useFocusBackWhenClosed(open);
  const release = useLeaveGuard(open && note !== '', 'Discard the note?');
  if (!open) return <Button ref={opener} onPress={() => setOpen(true)}>Add note</Button>;
  return (
    <Form onSubmit={(e) => { e.preventDefault(); onSave(note); release(); setNote(''); setOpen(false); }}>
      <TextField label="Note" name="note" isRequired value={note} onChange={setNote} />
      <Button type="submit">Save</Button>
    </Form>
  );
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('an inline form', () => {
  it('refuses to save an empty required field and says why', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<NoteForm onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Fill in this field.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Note/ }).getAttribute('aria-invalid')).toBe('true');
  });

  it('asks before leaving with unsaved text, and no longer once it saved', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<NoteForm onSave={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(mayLeave()).toBe(true);

    await user.type(screen.getByRole('textbox', { name: /Note/ }), 'Strong current');
    expect(mayLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Discard the note?');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    confirm.mockClear();
    expect(mayLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('gives focus back to the button that opened it once it closes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<NoteForm onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await user.type(screen.getByRole('textbox', { name: /Note/ }), 'Strong current{Enter}');
    expect(onSave).toHaveBeenCalledWith('Strong current');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add note' }));
  });
});
