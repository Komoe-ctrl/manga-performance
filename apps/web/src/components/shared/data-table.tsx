"use client";

import { useMemo, useState } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared";

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic },
});

export interface Column<T> {
  id: string;
  header: string;
  /** Valeur utilisée pour le tri. Absent = colonne non triable. */
  sortValue?: (row: T) => string | number | undefined;
  cell: (row: T) => React.ReactNode;
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  pageSize?: number;
  emptyMessage?: string;
  caption: string;
}

/** Tableau générique (TanStack Table) : tri, pagination, sélection multiple. */
export function DataTable<T extends object>({
  data,
  columns,
  getRowId,
  selectable = false,
  onSelectionChange,
  pageSize = 10,
  emptyMessage = "Aucun résultat.",
  caption,
}: Props<T>) {
  const [rowSelection, setRowSelection] = useState<Record<string, true>>({});
  const helper = useMemo(() => createColumnHelper<typeof features, T>(), []);

  const tableColumns = useMemo(() => {
    const cols = columns.map((c) =>
      helper.accessor((row: T) => c.sortValue?.(row) ?? "", {
        id: c.id,
        header: c.header,
        enableSorting: !!c.sortValue,
        sortFn: "basic",
        cell: (ctx) => c.cell(ctx.row.original),
      }),
    );
    return helper.columns(cols);
  }, [columns, helper]);

  const table = useTable({
    features,
    columns: tableColumns,
    data,
    getRowId,
    enableRowSelection: selectable,
    state: { rowSelection },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setRowSelection(next);
      onSelectionChange?.(Object.keys(next));
    },
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const rows = table.getRowModel().rows;
  if (data.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted text-left">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {selectable && (
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tout sélectionner"
                      checked={table.getIsAllRowsSelected()}
                      onChange={table.getToggleAllRowsSelectedHandler()}
                    />
                  </th>
                )}
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className="whitespace-nowrap px-3 py-2 font-semibold"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:underline"
                        >
                          {String(header.column.columnDef.header)}
                          {sorted === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        String(header.column.columnDef.header)
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className={row.getIsSelected() ? "bg-accent/10" : undefined}>
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Sélectionner la ligne"
                      checked={row.getIsSelected()}
                      onChange={row.getToggleSelectedHandler()}
                    />
                  </td>
                )}
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2">
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>
            Page {table.state.pagination.pageIndex + 1} / {table.getPageCount()} — {data.length} lignes
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Précédent
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
