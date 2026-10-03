import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropZone, FileTrigger, Text, type FileDropItem } from 'react-aria-components';
import { importsQuery, keys, uploadFile, type ImportView } from './api.ts';
import { useErrorText } from './lib/display.ts';
import { IMPORTABLE, splitImportable } from './lib/importable.ts';
import { Button, Muted, Notice, Panel } from './ui/index.ts';

export function ImportPanel() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const imports = useQuery(importsQuery());
  const [skipped, setSkipped] = useState<string[]>([]);

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
        onDrop={async (e) => {
          const files = e.items.filter((item): item is FileDropItem => item.kind === 'file');
          const { accepted, skipped } = splitImportable(files.map((f) => f.name));
          setSkipped(skipped);
          const chosen = files.filter((f) => accepted.includes(f.name));
          if (chosen.length > 0) upload.mutate(await Promise.all(chosen.map((f) => f.getFile())));
        }}
      >
        <Text slot="label" className="dropzone-label">{t('import.drop')}</Text>
        <FileTrigger
          acceptedFileTypes={[...IMPORTABLE]}
          allowsMultiple
          onSelect={(list) => { setSkipped([]); if (list) upload.mutate(Array.from(list)); }}
        >
          <Button isPending={upload.isPending}>{t('import.choose')}</Button>
        </FileTrigger>
        <Muted>{t('import.hint')}</Muted>
      </DropZone>
      {upload.isPending && <Muted>{t('import.uploading')}</Muted>}
      {upload.error && <Notice tone="danger">{errorText(upload.error)}</Notice>}
      {skipped.length > 0 && <Notice tone="danger">{t('import.skipped', { names: skipped.join(', ') })}</Notice>}
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
        // A Duplicate candidate decided since the Import says what became of it (UI review A9).
        const decision = o.result === 'duplicate-candidate' && o.decision && o.decision !== 'open' ? o.decision : undefined;
        const result = decision ? t(`import.decision.${decision}`) : t(`import.result.${o.result}`);
        const detail = decision ? '' : [o.reason && t(`import.reason.${o.reason}`), o.message].filter(Boolean).join(', ');
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
