import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DropZone, FileTrigger, Text, type FileDropItem } from 'react-aria-components';
import { importsQuery, keys, uploadFile, type ImportView } from './api.ts';
import { useErrorText } from './lib/display.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

export function ImportPanel() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const imports = useQuery(importsQuery());

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadFile(file);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.imports }),
  });

  // When an Import finishes, the logbook may have new dives.
  const running = imports.data?.some((i) => i.status === 'pending' || i.status === 'processing');
  useEffect(() => {
    if (!running) void queryClient.invalidateQueries({ queryKey: keys.dives });
  }, [running, queryClient]);

  return (
    <Panel title={t('import.title')}>
      <DropZone
        className="dropzone"
        aria-label={t('import.drop')}
        onDrop={async (e) => {
          const files = e.items.filter((item): item is FileDropItem => item.kind === 'file');
          upload.mutate(await Promise.all(files.map((f) => f.getFile())));
        }}
      >
        <Text slot="label" className="dropzone-label">{t('import.drop')}</Text>
        <FileTrigger acceptedFileTypes={['.fit', '.zip']} allowsMultiple onSelect={(list) => list && upload.mutate(Array.from(list))}>
          <Button>{t('import.choose')}</Button>
        </FileTrigger>
        <Muted>{t('import.hint')}</Muted>
      </DropZone>
      {upload.isPending && <Muted>{t('import.uploading')}</Muted>}
      {upload.error && <Notice tone="danger">{errorText(upload.error)}</Notice>}
      {imports.data && imports.data.length > 0 && (
        <ul className="imports">
          {imports.data.slice(0, 8).map((i) => <ImportRow key={i.id} item={i} />)}
        </ul>
      )}
    </Panel>
  );
}

function ImportRow({ item }: { item: ImportView }) {
  const { t } = useTranslation();
  return (
    <li>
      <span className="import-name">{item.uploadName}</span>
      <span className={`status status-${item.status}`}>{t(`import.status.${item.status}`)}</span>
      {item.errorCode && (
        <span className="status-failed">
          {t(`import.errorCode.${item.errorCode}`)}{item.error && ` (${item.error})`}
        </span>
      )}
      {item.outcome.map((o, n) => {
        const result = t(`import.result.${o.result}`);
        const detail = [o.reason && t(`import.reason.${o.reason}`), o.message].filter(Boolean).join(', ');
        return (
          <span key={n} className="import-outcome">
            {o.diveId ? <a href={`#/dives/${o.diveId}`}>{result}</a> : result}
            {detail && ` (${detail})`}
          </span>
        );
      })}
    </li>
  );
}
