import type { ReactNode } from 'react';
import type { NewsRow, RoundNews } from './report';

/**
 * The round report under the round banner: the line, then each unit something happened to, yours
 * first, clear of the camera buttons down the right edge. `children` go beside Done (more actions,
 * such as opening the battle log).
 */
export function RoundReport({ news, onClose, children }: { news: RoundNews; onClose: () => void; children?: ReactNode }) {
  const groups: [string, NewsRow[]][] = [
    ['Yours', news.rows.filter((r) => r.side === 'blue')],
    ['Theirs, as Seen', news.rows.filter((r) => r.side === 'red')],
  ];
  return (
    <div className="pointer-events-auto mr-auto ml-4 w-[22rem] max-w-[calc(100%-4.5rem)] rounded-2xl bg-black/85 px-4 pt-3 pb-2 text-left text-white shadow-lg backdrop-blur" role="status" data-testid="arena-report">
      <div className="text-[15px] font-semibold" data-testid="arena-report-summary">
        {news.summary}
      </div>
      {news.rows.length > 0 && (
        <div className="mt-1 max-h-[34vh] overflow-y-auto">
          {groups.map(
            ([title, rows]) =>
              rows.length > 0 && (
                <section key={title} className="mt-1.5">
                  <h3 className="text-[13px] font-semibold text-muted">{title}</h3>
                  <ul>
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-baseline justify-between gap-3 py-0.5 text-[14px]" data-testid={`report-${r.id}`}>
                        <span className="min-w-0 truncate">{r.name}</span>
                        <span className={`shrink-0 text-right ${r.lost ? 'font-bold' : 'font-semibold'}`}>{r.words.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
      <div className="mt-1 flex justify-end gap-2">
        {children}
        <button type="button" onClick={onClose} className="h-11 min-w-11 rounded-full px-4 text-[15px] font-semibold text-white" data-testid="arena-report-close">
          Done
        </button>
      </div>
    </div>
  );
}
