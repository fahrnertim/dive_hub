import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from './Button.tsx';

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
      <Button onPress={async () => { await navigator.clipboard.writeText(value); setCopied(true); }}>
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}
