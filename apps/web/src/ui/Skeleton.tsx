// Loading (UI overhaul): flat bars in the shape of what comes, shown only after SHOW_AFTER_MS so a fast load shows
// nothing, then the content. Screen readers get one "Loading…" and the wrapper is busy; the bars are decoration.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const SHOW_AFTER_MS = 150;

/** False until `ms` have passed since the first render. */
export function useDelayed(ms: number): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return passed;
}

export function Skeleton({ children, label }: { children: ReactNode; label?: string }) {
  const { t } = useTranslation();
  const shown = useDelayed(SHOW_AFTER_MS);
  return (
    <div className="skeleton" aria-busy="true">
      <span className="visually-hidden">{label ?? t('common.loading')}</span>
      {shown && <div className="skeleton-shape" aria-hidden="true">{children}</div>}
    </div>
  );
}

/** One text line at the current font size. */
export function SkeletonLine({ width }: { width: string }) {
  return <span className="skeleton-bar skeleton-line" style={{ width }} />;
}

export function SkeletonBlock({ height, width }: { height: string; width?: string }) {
  return <span className="skeleton-bar skeleton-block" style={{ height, ...(width && { width }) }} />;
}

/** The Divers, sites, centres and settings lists: `rows` rows of a name and a shorter second line. */
export function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <Skeleton>
      <div className="skeleton-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div className="skeleton-row" key={i}>
            <SkeletonLine width={`${40 + (i % 3) * 10}%`} />
            <SkeletonLine width={`${20 + (i % 2) * 10}%`} />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

/** Eight rows on the dive-row grid (pages.css), with a block the size of the profile sketch. */
export function LogbookSkeleton() {
  return (
    <Skeleton>
      <div className="dive-list">
        <div className="dive-grid">
          <div className="dive-group">
            <div className="dive-rows">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="dive-row" key={i}>
                  <span className="dive-no"><SkeletonLine width="2ch" /></span>
                  <div className="dive-main">
                    <SkeletonLine width={`${45 + (i % 3) * 10}%`} />
                    <SkeletonLine width={`${25 + (i % 2) * 10}%`} />
                  </div>
                  <span className="skeleton-bar sketch" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Skeleton>
  );
}

/** The dive page: the title, the facts strip and the profile. */
export function DiveSkeleton() {
  return (
    <Skeleton>
      <div className="skeleton-dive">
        <SkeletonBlock height="2rem" width="50%" />
        <SkeletonBlock height="5.5rem" />
        <SkeletonBlock height="30rem" />
      </div>
    </Skeleton>
  );
}
