import { useId, useState } from 'react';
import { Search, SlidersHorizontal, X, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';

function SearchField({ value, onChange, placeholder, label, inputMode, id }) {
  return (
    <div className="n-search">
      <Search className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden />
      <input
        id={id}
        type="search"
        className="n-search__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label || placeholder}
        enterKeyHint="search"
        inputMode={inputMode}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {value ? (
        <button
          type="button"
          className="n-search__clear"
          aria-label="Clear"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onChange('')}
        >
          <XCircle className="h-[18px] w-[18px]" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Native list controls: search + a Filters sheet. Active filters show as
 * removable chips so the current view is always explained.
 *
 * groups: [{ id, label, value, onChange, options: [{ value, label }], defaultValue = 'all' }]
 * fields: [{ id, label, value, onChange, placeholder }]
 */
export default function NativeFilterBar({
  search,
  onSearch,
  placeholder = 'Search',
  groups = [],
  fields = [],
}) {
  const [open, setOpen] = useState(false);
  const baseId = useId();

  const activeGroups = groups.filter((g) => g.value !== (g.defaultValue ?? 'all'));
  const activeFields = fields.filter((f) => f.value);
  const activeCount = activeGroups.length + activeFields.length;
  const hasFilters = groups.length > 0 || fields.length > 0;

  const resetAll = () => {
    groups.forEach((g) => g.onChange(g.defaultValue ?? 'all'));
    fields.forEach((f) => f.onChange(''));
  };

  return (
    <>
      <div className="n-filterbar">
        <SearchField value={search} onChange={onSearch} placeholder={placeholder} />
        {hasFilters ? (
          <button
            type="button"
            className="n-filterbtn"
            data-active={activeCount > 0 ? 'true' : 'false'}
            aria-label={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal className="h-5 w-5" strokeWidth={2} aria-hidden />
            {activeCount > 0 ? (
              <span className="n-iconbtn__badge" aria-hidden>
                {activeCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {activeCount > 0 ? (
        <div className="n-chips" role="list" aria-label="Active filters">
          {activeGroups.map((g) => {
            const option = g.options.find((o) => o.value === g.value);
            return (
              <button
                key={g.id}
                type="button"
                role="listitem"
                className="n-chip"
                data-selected="true"
                onClick={() => g.onChange(g.defaultValue ?? 'all')}
                aria-label={`${g.label}: ${option?.label ?? g.value}. Remove filter`}
              >
                {option?.label ?? g.value}
                <X className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
              </button>
            );
          })}
          {activeFields.map((f) => (
            <button
              key={f.id}
              type="button"
              role="listitem"
              className="n-chip"
              data-selected="true"
              onClick={() => f.onChange('')}
              aria-label={`${f.label}: ${f.value}. Remove filter`}
            >
              {f.label}: {f.value}
              <X className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
            </button>
          ))}
        </div>
      ) : null}

      {hasFilters ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent onOpenAutoFocus={(event) => event.preventDefault()}>
            <div className="n-sheet__head">
              <DialogTitle className="n-sheet__title">Filters</DialogTitle>
              <DialogDescription className="sr-only">Narrow down the list</DialogDescription>
            </div>

            <div>
              {groups.map((g) => {
                const labelId = `${baseId}-${g.id}`;
                return (
                  <div key={g.id} className="n-fgroup">
                    <p id={labelId} className="n-fgroup__label">
                      {g.label}
                    </p>
                    <div className="n-fgroup__options" role="group" aria-labelledby={labelId}>
                      {g.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          className="n-chip"
                          aria-pressed={g.value === o.value}
                          onClick={() => g.onChange(o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {fields.map((f) => (
                <div key={f.id} className="n-fgroup">
                  <label className="n-fgroup__label" htmlFor={`${baseId}-${f.id}`}>
                    {f.label}
                  </label>
                  <SearchField
                    id={`${baseId}-${f.id}`}
                    value={f.value}
                    onChange={f.onChange}
                    placeholder={f.placeholder}
                    label={f.label}
                  />
                </div>
              ))}
            </div>

            <div className="n-sheet__actions n-sheet__actions--row">
              <button
                type="button"
                className="n-btn n-btn--tinted"
                data-tone="neutral"
                onClick={resetAll}
                disabled={activeCount === 0}
              >
                Reset
              </button>
              <button type="button" className="n-btn" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
