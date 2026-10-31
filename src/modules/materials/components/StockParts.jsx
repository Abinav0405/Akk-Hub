/**
 * Presentation pieces for the Stock screen (MaterialsManager). Display only — every action is a
 * callback into MaterialsManager, which keeps the existing data logic.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle, ArrowDownLeft, ArrowUpCircle, ArrowUpRight, Boxes, CheckCircle2, History,
    MoreHorizontal, Pencil, Printer, SlidersHorizontal, Trash2, XCircle,
} from 'lucide-react';
import { LOW_STOCK_THRESHOLD } from '@/modules/materials/lib/inventory';
import './stock.css';

/** Same rules as filterAndSortMaterials / the old badges: out = 0, low = 1…threshold, in = above. */
export function stockStatus(quantity) {
    if (quantity === 0) return 'out';
    if (quantity > 0 && quantity <= LOW_STOCK_THRESHOLD) return 'low';
    return 'in';
}

const STATUS = {
    in: { label: 'In stock', Icon: CheckCircle2 },
    low: { label: 'Low stock', Icon: AlertTriangle },
    out: { label: 'Out of stock', Icon: XCircle },
};

export function StatusBadge({ quantity }) {
    const key = stockStatus(quantity);
    const { label, Icon } = STATUS[key];
    return (
        <span className="stk-badge" data-status={key}>
            <Icon aria-hidden /> {label}
        </span>
    );
}

export function RefPill({ value }) {
    return <span className="stk-ref">#{value}</span>;
}

/** Four summary tiles; tapping one filters the list (tap again to clear). */
export function SummaryTiles({ counts, active, onPick }) {
    const tiles = [
        { key: 'all', label: 'Total materials', value: counts.total, Icon: Boxes },
        { key: 'in', label: 'In stock', value: counts.in, Icon: CheckCircle2 },
        { key: 'low', label: 'Low stock', value: counts.low, Icon: AlertTriangle, hint: `${LOW_STOCK_THRESHOLD} or fewer` },
        { key: 'out', label: 'Out of stock', value: counts.out, Icon: XCircle },
    ];
    return (
        <div className="stk-tiles" role="group" aria-label="Inventory summary — tap to filter">
            {tiles.map(({ key, label, value, Icon, hint }) => (
                <button
                    key={key}
                    type="button"
                    className="stk-tile"
                    data-status={key}
                    aria-pressed={key === 'all' ? undefined : active === key}
                    onClick={() => onPick(active === key && key !== 'all' ? 'all' : key)}
                >
                    <span className="stk-tile__icon" aria-hidden>
                        <Icon />
                    </span>
                    <span className="stk-tile__value">{value ?? '—'}</span>
                    <span className="stk-tile__label">
                        {label}
                        {hint ? <span className="stk-tile__hint"> · {hint}</span> : null}
                    </span>
                </button>
            ))}
        </div>
    );
}

/**
 * Row / card actions. Wide: History · Restock · Edit as icon buttons, Print + Delete under More.
 * Compact: everything under one More button.
 */
export function MaterialActions({ material, compact, onHistory, onRestock, onEdit, onPrint, onDelete }) {
    const menu = [
        compact && { key: 'history', label: 'View history', Icon: History, run: onHistory },
        compact && { key: 'restock', label: 'Restock', Icon: ArrowUpCircle, run: onRestock },
        compact && { key: 'edit', label: 'Edit', Icon: Pencil, run: onEdit },
        { key: 'print', label: 'Print', Icon: Printer, run: onPrint },
        { key: 'delete', label: 'Delete', Icon: Trash2, run: onDelete, danger: true },
    ].filter(Boolean);
    const name = `#${material.reference_number} ${material.name}`;
    return (
        <div className="stk-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {compact ? null : (
                <>
                    <IconAction label={`View history of ${name}`} tip="History" Icon={History} onClick={onHistory} />
                    <IconAction label={`Restock ${name}`} tip="Restock" Icon={ArrowUpCircle} onClick={onRestock} tone="success" />
                    <IconAction label={`Edit ${name}`} tip="Edit" Icon={Pencil} onClick={onEdit} />
                </>
            )}
            <MoreMenu label={`More actions for ${name}`} items={menu} />
        </div>
    );
}

function IconAction({ label, tip, Icon, onClick, tone }) {
    return (
        <button type="button" className="stk-iconbtn" data-tone={tone} aria-label={label} title={tip} onClick={onClick}>
            <Icon aria-hidden />
        </button>
    );
}

/** Small dropdown menu, portaled so table scrolling never clips it. */
function MoreMenu({ label, items }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const btnRef = useRef(null);
    const menuRef = useRef(null);

    useLayoutEffect(() => {
        if (!open || !btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        const width = 200;
        const height = items.length * 44 + 12;
        const below = r.bottom + 6 + height < window.innerHeight;
        setPos({
            left: Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)),
            top: below ? r.bottom + 6 : Math.max(8, r.top - height - 6),
            width,
        });
    }, [open, items.length]);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => {
            if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setOpen(false);
                btnRef.current?.focus();
            }
        };
        const onScroll = () => setOpen(false);
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onScroll, true);
        window.requestAnimationFrame(() => menuRef.current?.querySelector('button')?.focus());
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [open]);

    const onMenuKey = (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const buttons = [...(menuRef.current?.querySelectorAll('button') || [])];
        const i = buttons.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
    };

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                className="stk-iconbtn"
                aria-label={label}
                title="More"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <MoreHorizontal aria-hidden />
            </button>
            {open && pos
                ? createPortal(
                      <div
                          ref={menuRef}
                          role="menu"
                          className="stk-menu"
                          style={{ left: pos.left, top: pos.top, width: pos.width }}
                          onKeyDown={onMenuKey}
                      >
                          {items.map(({ key, label: text, Icon, run, danger }) => (
                              <button
                                  key={key}
                                  type="button"
                                  role="menuitem"
                                  className={`stk-menu__item${danger ? ' is-danger' : ''}`}
                                  onClick={() => {
                                      setOpen(false);
                                      run();
                                  }}
                              >
                                  <Icon aria-hidden /> {text}
                              </button>
                          ))}
                      </div>,
                      document.body,
                  )
                : null}
        </>
    );
}

/** Phone list card: tap opens history; More holds the actions. */
export function MaterialCard({ material, actions, onOpen }) {
    const status = stockStatus(material.quantity);
    return (
        <div
            className="stk-card"
            data-status={status}
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            aria-label={`${material.name}, ${material.quantity} ${material.unit}, ${STATUS[status].label}. Open history`}
        >
            <div className="stk-card__top">
                <div className="min-w-0">
                    <p className="stk-card__name">{material.name}</p>
                    <RefPill value={material.reference_number} />
                </div>
                {actions}
            </div>
            <div className="stk-card__bottom">
                <div>
                    <p className="stk-card__label">Available</p>
                    <p className="stk-card__qty" data-status={status}>
                        {material.quantity} <span>{material.unit}</span>
                    </p>
                </div>
                <StatusBadge quantity={material.quantity} />
            </div>
        </div>
    );
}

/** One movement in the history drawer. */
const MOVE = {
    take: { label: 'Issued', Icon: ArrowUpRight, tone: 'out' },
    return: { label: 'Returned', Icon: ArrowDownLeft, tone: 'in' },
    restock: { label: 'Restocked', Icon: ArrowUpCircle, tone: 'add' },
    adjustment: { label: 'Adjusted', Icon: SlidersHorizontal, tone: 'adjust' },
};

export function HistoryItem({ entry, unit, date }) {
    const move = MOVE[entry.action_type] || { label: entry.action_type || 'Change', Icon: History, tone: 'adjust' };
    const change = Number(entry.quantity_change) || 0;
    const signed = change > 0 ? `+${change}` : String(change);
    const who = entry.worker_name
        ? `${entry.worker_name}${entry.worker_id ? ` (${entry.worker_id})` : ''}`
        : entry.performed_by || null;
    return (
        <li className="stk-move" data-tone={move.tone}>
            <span className="stk-move__icon" aria-hidden>
                <move.Icon />
            </span>
            <div className="min-w-0 flex-1">
                <div className="stk-move__head">
                    <p className="stk-move__title">{move.label}</p>
                    <p className="stk-move__change" data-sign={change > 0 ? 'up' : change < 0 ? 'down' : 'none'}>
                        {signed} {unit}
                    </p>
                </div>
                <p className="stk-move__meta">
                    {[who, entry.site_name ? `Site: ${entry.site_name}` : null, entry.quantity_after != null ? `Left: ${entry.quantity_after} ${unit}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
                {entry.notes ? <p className="stk-move__notes">{entry.notes}</p> : null}
                {entry.performed_by && entry.worker_name ? <p className="stk-move__meta">By {entry.performed_by}</p> : null}
                <p className="stk-move__date">{date}</p>
            </div>
        </li>
    );
}
