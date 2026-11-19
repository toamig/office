import { useState, type ReactNode } from "react";

/** A card: an optional header with an action, and a body. */
export function Card({
  title,
  action,
  children,
  testId,
  onOpen,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Makes the whole card a button that opens what it shows. */
  onOpen?: () => void;
}) {
  return (
    <section
      className="ui-card"
      data-testid={testId}
      data-clickable={onOpen ? "true" : undefined}
      {...(onOpen
        ? {
            role: "button",
            tabIndex: 0,
            onClick: onOpen,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onOpen();
              }
            },
          }
        : {})}
    >
      {title && (
        <header className="ui-card-head">
          <h2 className="m-0 text-[length:var(--text-md)]">{title}</h2>
          {action}
        </header>
      )}
      <div className="ui-card-body">{children}</div>
    </section>
  );
}

/** A row of a list: leading content, the main text, and trailing content; selectable and clickable. */
export function ListRow({
  leading,
  children,
  trailing,
  selected = false,
  onClick,
  testId,
}: {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <div
      className="ui-row"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-clickable={onClick ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </div>
  );
}

export interface Column<R> {
  id: string;
  header: string;
  cell: (row: R) => ReactNode;
  /** A value to sort by; a column without one is not sortable. */
  sortBy?: (row: R) => string | number;
}

/** A table with a sticky header and sortable columns. */
export function Table<R>({
  columns,
  rows,
  rowKey,
  label,
}: {
  columns: Array<Column<R>>;
  rows: R[];
  rowKey: (row: R) => string;
  label: string;
}) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const column = columns.find((c) => c.id === sort?.id);
  const sorted =
    sort && column?.sortBy
      ? [...rows].sort((a, b) => {
          const x = column.sortBy?.(a) ?? "";
          const y = column.sortBy?.(b) ?? "";
          return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
        })
      : rows;
  return (
    <table className="ui-table" aria-label={label}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.id}
              scope="col"
              aria-sort={
                sort?.id === c.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined
              }
            >
              {c.sortBy ? (
                <button
                  type="button"
                  className="m-0 border-0 bg-transparent p-0 font-[inherit] text-[inherit] text-[color:inherit]"
                  onClick={() =>
                    setSort(
                      sort?.id === c.id
                        ? { id: c.id, dir: sort.dir === 1 ? -1 : 1 }
                        : { id: c.id, dir: 1 },
                    )
                  }
                >
                  {c.header}
                  {sort?.id === c.id ? (sort.dir === 1 ? " (up)" : " (down)") : ""}
                </button>
              ) : (
                c.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => (
              <td key={c.id}>{c.cell(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
