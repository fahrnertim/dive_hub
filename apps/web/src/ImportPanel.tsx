import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileTrigger } from 'react-aria-components';
import { importsQuery, keys, uploadFile, type ImportView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { IMPORTABLE, splitImportable } from './lib/importable.ts';
import { Badge, Button, Muted, Notice, Panel } from './ui/index.ts';

const isRunning = (i: ImportView) => i.status === 'pending' || i.status === 'processing';
const statusTone = (i: ImportView) => {
  if (i.status === 'done') return 'success';
  return i.status === 'failed' ? 'danger' : 'neutral';
};
/** Imports shown without "Show all": the running ones and those of the last day, at most this many. */
const RECENT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ImportState {
  /** Uploads the importable files and names the rest. */
  accept: (files: File[]) => void;
  uploading: boolean;
  /** How many files are being uploaded. */
  uploadingCount: number;
  error: unknown;
  skipped: string[];
  /** Files are being dragged over the page. */
  dragging: boolean;
}
const ImportContext = createContext<ImportState | null>(null);

function useImport(): ImportState {
  const state = use(ImportContext);
  if (!state) throw new Error('useImport needs an ImportProvider');
  return state;
}

/**
 * Importing on the logbook page (UI review B5): files dropped anywhere on the page are uploaded,
 * the "Import files" button picks them. Also tells screen readers how each Import ended.
 */
export function ImportProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const imports = useQuery(importsQuery());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadFile(file);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.imports }),
  });
  const { mutate } = upload;
  const accept = useCallback((files: File[]) => {
    const { accepted, skipped: rest } = splitImportable(files.map((f) => f.name));
    setSkipped(rest);
    const chosen = files.filter((f) => accepted.includes(f.name));
    if (chosen.length === 0) return;
    announce(t('import.uploading', { count: chosen.length }));
    mutate(chosen);
  }, [mutate, t]);

  // When an Import finishes: the logbook may have new dives, and its result is announced.
  const running = imports.data?.some(isRunning);
  useEffect(() => {
    if (!running) void queryClient.invalidateQueries({ queryKey: keys.dives });
  }, [running, queryClient]);
  const seenRunning = useRef(new Set<string>());
  const describe = useDescribeOutcome();
  useEffect(() => {
    for (const i of imports.data ?? []) {
      if (isRunning(i)) seenRunning.current.add(i.id);
      else if (seenRunning.current.delete(i.id)) announce(t('import.finished', { name: i.uploadName, result: describe(i) }));
    }
  }, [imports.data, describe, t]);

  // Files dragged anywhere over the page can be dropped there.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth += 1; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      accept([...(e.dataTransfer?.files ?? [])]);
    };
    addEventListener('dragenter', enter);
    addEventListener('dragleave', leave);
    addEventListener('dragover', over);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragleave', leave);
      removeEventListener('dragover', over);
      removeEventListener('drop', drop);
    };
  }, [accept]);

  const state = { accept, uploading: upload.isPending, uploadingCount: upload.variables?.length ?? 0, error: upload.error, skipped, dragging };
  return (
    <ImportContext value={state}>
      {children}
      {dragging && <div className="page-drop" aria-hidden="true"><p>{t('import.dropNow')}</p></div>}
    </ImportContext>
  );
}

/** Opens the file picker; busy while uploading. */
export function ImportFilesButton({ label, variant }: { label?: string; variant?: 'primary' | 'secondary' }) {
  const { t } = useTranslation();
  const { accept, uploading } = useImport();
  return (
    <FileTrigger acceptedFileTypes={[...IMPORTABLE]} allowsMultiple onSelect={(list) => list && accept(Array.from(list))}>
      <Button variant={variant} icon="import" isPending={uploading}>{label ?? t('import.importFiles')}</Button>
    </FileTrigger>
  );
}

function ImportNotices() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { error, skipped } = useImport();
  return (
    <>
      {error !== null && error !== undefined && <Notice tone="danger">{errorText(error)}</Notice>}
      {skipped.length > 0 && <Notice tone="danger">{t('import.skipped', { names: skipped.join(', ') })}</Notice>}
    </>
  );
}

/** First run (no dives yet): a large drop area, as the page's main action. */
export function ImportPanel() {
  const { t } = useTranslation();
  const { dragging } = useImport();
  const imports = useQuery(importsQuery());
  return (
    <Panel title={t('import.title')}>
      <div className="dropzone" data-drop-target={dragging || undefined}>
        <p className="dropzone-label">{t('import.drop')}</p>
        <ImportFilesButton label={t('import.choose')} />
        <Muted>{t('import.hint')}</Muted>
      </div>
      {/* First run: how to get the files at all (UI review C7). */}
      <h3 className="find-title">{t('import.findTitle')}</h3>
      <ul className="find-list">
        <li>{t('import.findConnect')}</li>
        <li>{t('import.findWatch')}</li>
      </ul>
      <ImportNotices />
      <ImportList imports={imports.data ?? []} />
    </Panel>
  );
}

/**
 * For a returning User: the logbook comes first, and Imports show here only while something is
 * running, happened in the last day, or went wrong. Older ones are behind "Show all imports".
 */
export function RecentImports() {
  const { t } = useTranslation();
  const { uploading, uploadingCount, error, skipped } = useImport();
  const imports = useQuery(importsQuery());
  const [now] = useState(() => Date.now());
  const all = imports.data ?? [];
  const recent = all.filter((i) => isRunning(i) || now - Date.parse(i.createdAt) < DAY_MS);
  if (recent.length === 0 && !uploading && !error && skipped.length === 0) return null;
  return (
    <Panel title={t('import.recent')}>
      {uploading && <Muted>{t('import.uploading', { count: uploadingCount })}</Muted>}
      <ImportNotices />
      <ImportList imports={all} />
    </Panel>
  );
}

function ImportList({ imports }: { imports: ImportView[] }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  if (imports.length === 0) return null;
  const shown = showAll ? imports : imports.slice(0, RECENT);
  return (
    <>
      <ul className="imports">
        {shown.map((i) => <ImportRow key={i.id} item={i} />)}
      </ul>
      {imports.length > RECENT && (
        <Button variant="quiet" onPress={() => setShowAll(!showAll)}>{showAll ? t('import.showFewer') : t('import.showAll')}</Button>
      )}
    </>
  );
}

/** One line for an Import's result, as announced when it finishes. */
function useDescribeOutcome() {
  const { t } = useTranslation();
  return useCallback((i: ImportView) => {
    if (i.errorCode) return t(`import.errorCode.${i.errorCode}`);
    return i.outcome.map((o) => t(`import.result.${o.result}`)).join(', ') || t(`import.status.${i.status}`);
  }, [t]);
}

function ImportRow({ item }: { item: ImportView }) {
  const { t } = useTranslation();
  return (
    <li>
      <span className="import-name">{item.uploadName}</span>
      {/* A state, so a badge: not a word in the colour that means "click" (visual refresh 3). */}
      <Badge tone={statusTone(item)}>{t(`import.status.${item.status}`)}</Badge>
      {item.errorCode && (
        <span className="import-error">
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
