import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { announce } from '../lib/announce.ts';
import { useErrorText } from '../lib/display.ts';
import { Button, type ButtonProps } from './Button.tsx';
import { Notice } from './Layout.tsx';

/** A modal dialog; focus stays inside and returns to the trigger when it closes. */
export function Dialog({ title, isOpen, onOpenChange, children }: {
  title: ReactNode; isOpen: boolean; onOpenChange: (open: boolean) => void; children: ReactNode;
}) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="modal-overlay">
      <Modal className="modal">
        <AriaDialog className="dialog">
          <Heading slot="title" className="dialog-title">{title}</Heading>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** A read-only value (an invitation or reset link) with a copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <input className="input" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      {/* Named with what it copies: a page can show several (the rule that no two buttons share a name). */}
      <Button icon={copied ? 'copied' : 'copy'} aria-label={t('common.forItem', { action: copied ? t('common.copied') : t('common.copy'), item: label })} onPress={async () => { await navigator.clipboard.writeText(value); setCopied(true); announce(t('common.copied')); }}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

/**
 * Asks before an action that is hard to undo (split off, disable, revoke, sign out everywhere) and
 * says what will happen (UI review B2). `onConfirm` runs the action; the dialog closes when it
 * succeeds and shows the error when it fails. Opened by `ConfirmButton`, or by a menu item.
 */
export function ConfirmDialog({ isOpen, onOpenChange, title, body, confirmLabel, onConfirm, onDone, tone = 'danger' }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; body: ReactNode; confirmLabel: string;
  onConfirm: () => Promise<unknown>; onDone?: (() => void) | undefined; tone?: 'danger' | 'primary' | undefined;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const confirm = async () => {
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title={title} isOpen={isOpen} onOpenChange={(open) => { setError(undefined); onOpenChange(open); }}>
      <p>{body}</p>
      {error !== undefined && <Notice tone="danger">{errorText(error)}</Notice>}
      <div className="form-actions">
        <Button variant={tone} isPending={pending} onPress={confirm}>{confirmLabel}</Button>
        <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}

/** A button whose action is hard to undo: it opens a ConfirmDialog. Focus returns to the button, or `onDone` moves it. */
export function ConfirmButton({ children, title, body, confirmLabel, onConfirm, onDone, tone, ...button }: Omit<ButtonProps, 'onPress' | 'children'> & {
  children: ReactNode; title: ReactNode; body: ReactNode; confirmLabel: string;
  onConfirm: () => Promise<unknown>; onDone?: () => void; tone?: 'danger' | 'primary';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...button} onPress={() => setOpen(true)}>{children}</Button>
      <ConfirmDialog
        isOpen={open} onOpenChange={setOpen} title={title} body={body} confirmLabel={confirmLabel}
        onConfirm={onConfirm} onDone={onDone} tone={tone}
      />
    </>
  );
}
