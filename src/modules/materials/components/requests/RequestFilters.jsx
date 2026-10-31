/**
 * Filters for the Requests screen: an inline toolbar for wide screens and a bottom sheet for
 * phones (web and app). Both edit the same filter object.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, Search, SlidersHorizontal, X } from 'lucide-react';
import Sheet from '@/ui/hub/Sheet';
import {
    DATE_OPTIONS, DEFAULT_FILTERS, RETURN_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS, activeFilterCount,
} from './requestModel';
import { Segmented } from './RequestParts';

export function SearchField({ value, onChange, placeholder = 'Search name, ID, material or code', autoFocus }) {
    return (
        <div className="rq-search">
            <Search aria-hidden />
            <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                aria-label="Search requests"
                placeholder={placeholder}
                value={value}
                autoFocus={autoFocus}
                onChange={(e) => onChange(e.target.value)}
            />
            {value ? (
                <button type="button" className="rq-search__clear" aria-label="Clear search" onClick={() => onChange('')}>
                    <X aria-hidden />
                </button>
            ) : null}
        </div>
    );
}

function SelectField({ label, value, onChange, options, compact }) {
    return (
        <label className="rq-select" data-compact={compact ? 'true' : undefined} data-active={value !== 'all' ? 'true' : undefined}>
            <span className="rq-select__label">{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown aria-hidden />
        </label>
    );
}

function DateRange({ filters, set }) {
    return (
        <div className="rq-range">
            <label>
                <span>From</span>
                <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label>
                <span>To</span>
                <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </label>
        </div>
    );
}

const withAllLabel = (opts, allLabel) => opts.map((o) => (o.value === 'all' ? { ...o, label: allLabel } : o));

/** Inline toolbar (≥ 900px). */
export function FilterToolbar({ filters, set, sites, onClear }) {
    const count = activeFilterCount(filters);
    return (
        <div className="rq-toolbar" role="search" aria-label="Filter requests">
            <div className="rq-toolbar__group">
                <span className="rq-toolbar__label" aria-hidden>Type</span>
                <Segmented label="Request type" value={filters.type} options={TYPE_OPTIONS} onChange={(type) => set({ type })} size="sm" />
            </div>
            <div className="rq-toolbar__group">
                <span className="rq-toolbar__label" aria-hidden>Approval</span>
                <Segmented label="Approval status" value={filters.status} options={STATUS_OPTIONS} onChange={(status) => set({ status })} size="sm" />
            </div>
            <SelectField compact label="Returns" value={filters.returns} options={withAllLabel(RETURN_OPTIONS, 'Any')} onChange={(returns) => set({ returns })} />
            <SelectField compact label="Date" value={filters.date} options={DATE_OPTIONS} onChange={(date) => set({ date })} />
            {filters.date === 'custom' ? <DateRange filters={filters} set={set} /> : null}
            {sites.length ? (
                <SelectField compact label="Site" value={filters.site} options={[{ value: 'all', label: 'All sites' }, ...sites.map((s) => ({ value: s, label: s }))]} onChange={(site) => set({ site })} />
            ) : null}
            <label className="rq-idfield" data-active={filters.workerId.trim() ? 'true' : undefined}>
                <span className="rq-select__label">Employee ID</span>
                <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    placeholder="Any"
                    value={filters.workerId}
                    onChange={(e) => set({ workerId: e.target.value })}
                />
            </label>
            {count > 0 ? (
                <button type="button" className="rq-btn rq-toolbar__clear" data-variant="ghost" data-size="sm" onClick={onClear}>
                    <X aria-hidden />
                    Clear filters
                </button>
            ) : null}
        </div>
    );
}

/** Filter button with active-count badge (phones). */
export function FilterButton({ filters, onClick }) {
    const count = activeFilterCount(filters);
    return (
        <button
            type="button"
            className="rq-btn rq-filterbtn"
            data-variant="secondary"
            data-active={count ? 'true' : undefined}
            aria-label={count ? `Filters, ${count} active` : 'Filters'}
            onClick={onClick}
        >
            <SlidersHorizontal aria-hidden />
            <span className="rq-filterbtn__text">Filters</span>
            {count ? <span className="rq-count" aria-hidden>{count}</span> : null}
        </button>
    );
}

function ChoiceChips({ label, value, options, onChange }) {
    return (
        <fieldset className="rq-fset">
            <legend>{label}</legend>
            <div className="rq-choices" role="radiogroup" aria-label={label}>
                {options.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={value === o.value}
                        className="rq-choice"
                        onClick={() => onChange(o.value)}
                    >
                        {o.label}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

/** Bottom sheet with every filter. Changes apply live; the footer shows the result count. */
export function FilterSheet({ open, onClose, filters, set, sites, resultCount }) {
    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Filter requests"
            subtitle={activeFilterCount(filters) ? `${activeFilterCount(filters)} active` : 'Combine any filters'}
            className="rq-sheet"
            footer={
                <div className="rq-sheet__foot">
                    <button
                        type="button"
                        className="rq-btn"
                        data-variant="ghost"
                        disabled={!activeFilterCount(filters)}
                        onClick={() => set({ ...DEFAULT_FILTERS, search: filters.search })}
                    >
                        Clear all
                    </button>
                    <button type="button" className="rq-btn" data-variant="primary" onClick={onClose}>
                        Show {resultCount.toLocaleString()} result{resultCount === 1 ? '' : 's'}
                    </button>
                </div>
            }
        >
            <div className="rq-sheet__body">
                <fieldset className="rq-fset">
                    <legend>Request type</legend>
                    <Segmented label="Request type" value={filters.type} options={TYPE_OPTIONS} onChange={(type) => set({ type })} />
                </fieldset>
                <fieldset className="rq-fset">
                    <legend>Approval status</legend>
                    <Segmented label="Approval status" value={filters.status} options={STATUS_OPTIONS} onChange={(status) => set({ status })} />
                </fieldset>
                <ChoiceChips label="Material returns" value={filters.returns} options={RETURN_OPTIONS} onChange={(returns) => set({ returns })} />
                <ChoiceChips label="Date" value={filters.date} options={DATE_OPTIONS} onChange={(date) => set({ date })} />
                {filters.date === 'custom' ? <DateRange filters={filters} set={set} /> : null}
                <label className="rq-fset rq-field">
                    <span className="rq-fset__legend">Employee ID</span>
                    <input
                        type="text"
                        autoComplete="off"
                        placeholder="e.g. 1024"
                        value={filters.workerId}
                        onChange={(e) => set({ workerId: e.target.value })}
                    />
                </label>
                {sites.length ? (
                    <label className="rq-fset rq-field">
                        <span className="rq-fset__legend">Site</span>
                        <span className="rq-field__select">
                            <select value={filters.site} onChange={(e) => set({ site: e.target.value })}>
                                <option value="all">All sites</option>
                                {sites.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <ChevronDown aria-hidden />
                        </span>
                    </label>
                ) : null}
            </div>
        </Sheet>
    );
}

/** Small overflow menu. items: [{ label, icon, onSelect, danger, disabled }] */
export function OverflowMenu({ items, label = 'More actions' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const shown = items.filter(Boolean);
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);
    if (!shown.length) return null;
    return (
        <div ref={ref} className="rq-menu">
            <button
                type="button"
                className="rq-iconbtn"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <MoreHorizontal aria-hidden />
            </button>
            {open ? (
                <div className="rq-menu__pop" role="menu">
                    {shown.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                className="rq-menu__item"
                                data-danger={item.danger ? 'true' : undefined}
                                disabled={item.disabled}
                                onClick={() => {
                                    setOpen(false);
                                    item.onSelect();
                                }}
                            >
                                {Icon ? <Icon aria-hidden /> : null}
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
