/**
 * Stock — the material catalogue (admin and manager): summary, add, search / filter / sort,
 * table on wide screens and cards on phones, history drawer, restock / edit / print / delete.
 * Presentation pieces: StockParts.jsx + stock.css. Data rules are unchanged.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { supabaseMaterials } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { storageKey } from '@/core/storage'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/dialog';
import {
    Pencil, Plus, Check, Search, Package, History, ChevronDown, SlidersHorizontal,
    ArrowUpCircle, AlertTriangle, Loader2, Printer, X
} from 'lucide-react';
import Sheet from '@/ui/hub/Sheet';
import { HistoryItem, MaterialActions, MaterialCard, RefPill, StatusBadge, SummaryTiles, stockStatus } from './StockParts';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import {
    fetchMaterialHistory, fetchMaterialsCatalog, restockMaterial, logMaterialHistory,
    formatHistoryEntry, LOW_STOCK_THRESHOLD,
} from '@/modules/materials/lib/inventory';
import { printSingleMaterial, printAllMaterials } from '@/modules/materials/lib/materialPrint';
import { printFailureMessage } from '@/modules/materials/lib/printDocument';
import { filterAndSortMaterials } from '@/modules/materials/lib/materialFilters';

const PAGE = 60; // rows / cards rendered at a time ("Show more" adds the next page)

/** Phones and narrow windows get cards instead of the table. */
function useCompact() {
    const query = '(max-width: 767px)';
    const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const apply = () => setCompact(mq.matches);
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, []);
    return compact;
}

const sortByRef = (items) =>
    [...items].sort((a, b) =>
        String(a.reference_number).localeCompare(String(b.reference_number), undefined, { numeric: true })
    );

export default function MaterialsManager() {
    const [materials, setMaterials] = useState([]);
    const [addForm, setAddForm] = useState({ reference_number: '', name: '', quantity: '', unit: 'pcs' });
    const [isAdding, setIsAdding] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [stockFilter, setStockFilter] = useState('all');
    const [unitFilter, setUnitFilter] = useState('all');
    const [sortMode, setSortMode] = useState('reference');
    const [loadState, setLoadState] = useState('loading'); // loading | ready | error
    const [addOpen, setAddOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches);
    const [addErrors, setAddErrors] = useState({});
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE);
    const compact = useCompact();

    // Edit dialog
    const [editMaterial, setEditMaterial] = useState(null);
    const [editForm, setEditForm] = useState({ reference_number: '', name: '', quantity: '', unit: 'pcs' });
    const [editLoading, setEditLoading] = useState(false);

    // History dialog
    const [historyMaterial, setHistoryMaterial] = useState(null);
    const [historyEntries, setHistoryEntries] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState(false);

    // Restock dialog
    const [restockMaterial_, setRestockMaterial] = useState(null);
    const [restockQty, setRestockQty] = useState('');
    const [restockNotes, setRestockNotes] = useState('');
    const [restockLoading, setRestockLoading] = useState(false);

    // Print dialog: { mode: 'single' | 'all', material?: object }
    const [printDialog, setPrintDialog] = useState(null);
    const [printIncludeHistory, setPrintIncludeHistory] = useState(true);
    const [printLoading, setPrintLoading] = useState(false);

    const fetchMaterials = useCallback(async () => {
        try {
            // Every page of the catalogue (a plain select stops at Supabase's 1000-row default).
            const data = await fetchMaterialsCatalog();
            setMaterials(sortByRef(data || []));
            setLoadState('ready');
        } catch (error) {
            console.error('Error fetching materials:', error);
            setLoadState((s) => (s === 'ready' ? s : 'error'));
            toast.error('Failed to load materials. Have you run the database migration?');
        }
    }, []);

    useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

    const units = [...new Set(materials.map((m) => m.unit).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    const filteredMaterials = filterAndSortMaterials(materials, {
        searchTerm,
        stockFilter,
        unitFilter,
        sortMode,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
    });
    const hasFilters = !!searchTerm || stockFilter !== 'all' || unitFilter !== 'all' || sortMode !== 'reference';

    const resetAddForm = () => {
        setAddForm({ reference_number: '', name: '', quantity: '', unit: 'pcs' });
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        const refNo = addForm.reference_number.trim();
        const name = addForm.name.trim();
        const unit = addForm.unit.trim() || 'pcs';

        if (!refNo || !name) {
            setAddErrors({ reference_number: refNo ? '' : 'Enter a reference number', name: name ? '' : 'Enter the material name' });
            toast.error('Reference number and name are required');
            return;
        }
        if (materials.some((m) => String(m.reference_number).trim().toLowerCase() === refNo.toLowerCase())) {
            setAddErrors({ reference_number: `#${refNo} is already in the list` });
            toast.error('A material with this reference number already exists');
            return;
        }
        setAddErrors({});

        setIsAdding(true);
        const adminName = sessionStorage.getItem(storageKey('materials', 'adminName')) || 'Admin';

        try {
            const qty = parseInt(addForm.quantity);
            const initialQty = isNaN(qty) || qty < 0 ? 0 : qty;

            const { data: inserted, error } = await supabaseMaterials
                .from('materials_catalog')
                .insert([{
                    reference_number: refNo,
                    name,
                    quantity: initialQty,
                    unit,
                }])
                .select()
                .single();
            if (error) throw error;

            if (initialQty > 0) {
                await logMaterialHistory({
                    materialId: inserted.id,
                    referenceNumber: refNo,
                    actionType: 'restock',
                    quantityChange: initialQty,
                    quantityAfter: initialQty,
                    performedBy: adminName,
                    notes: `Initial stock: ${initialQty} ${unit}`,
                });
            }

            toast.success('Material added');
            resetAddForm();
            fetchMaterials();
        } catch (error) {
            console.error('Error saving material:', error);
            if (error.code === '23505') {
                toast.error('A material with this reference number already exists');
            } else {
                toast.error(error.message || 'Failed to save material');
            }
        } finally {
            setIsAdding(false);
        }
    };

    const handleEditSave = async (e) => {
        e.preventDefault();
        if (!editMaterial) return;

        const refNo = editForm.reference_number.trim();
        const name = editForm.name.trim();
        const unit = editForm.unit.trim() || 'pcs';

        if (!refNo || !name) {
            toast.error('Reference number and name are required');
            return;
        }

        setEditLoading(true);
        const adminName = sessionStorage.getItem(storageKey('materials', 'adminName')) || 'Admin';

        try {
            const { error } = await supabaseMaterials
                .from('materials_catalog')
                .update({
                    reference_number: refNo,
                    name,
                    unit,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', editMaterial.id);
            if (error) throw error;

            const newQty = parseInt(editForm.quantity);
            if (!isNaN(newQty) && newQty !== editMaterial.quantity) {
                const diff = newQty - editMaterial.quantity;
                await supabaseMaterials
                    .from('materials_catalog')
                    .update({ quantity: newQty })
                    .eq('id', editMaterial.id);

                await logMaterialHistory({
                    materialId: editMaterial.id,
                    referenceNumber: refNo,
                    actionType: 'adjustment',
                    quantityChange: diff,
                    quantityAfter: newQty,
                    performedBy: adminName,
                    notes: `Manual adjustment by ${adminName}`,
                });
            }

            toast.success('Material updated');
            setEditMaterial(null);
            fetchMaterials();
        } catch (error) {
            console.error('Error updating material:', error);
            if (error.code === '23505') {
                toast.error('A material with this reference number already exists');
            } else {
                toast.error(error.message || 'Failed to update material');
            }
        } finally {
            setEditLoading(false);
        }
    };

    const handleEdit = (material) => {
        setEditMaterial(material);
        setEditForm({
            reference_number: material.reference_number,
            name: material.name,
            quantity: String(material.quantity),
            unit: material.unit,
        });
    };

    const handleDelete = async (material) => {
        if (!(await confirmAction({
            title: 'Delete material?',
            message: `Delete "${material.name}" (#${material.reference_number})? This cannot be undone.`,
            confirmLabel: 'Delete',
            destructive: true,
        }))) return;

        try {
            const { error } = await supabaseMaterials
                .from('materials_catalog')
                .delete()
                .eq('id', material.id);
            if (error) throw error;
            toast.success('Material deleted');
            if (editMaterial?.id === material.id) setEditMaterial(null);
            fetchMaterials();
        } catch (error) {
            toast.error(error.message || 'Failed to delete material');
        }
    };

    const openHistory = async (material) => {
        setHistoryMaterial(material);
        setHistoryLoading(true);
        setHistoryError(false);
        try {
            const entries = await fetchMaterialHistory(material.id);
            setHistoryEntries(entries);
        } catch {
            toast.error('Failed to load history');
            setHistoryEntries([]);
            setHistoryError(true);
        } finally {
            setHistoryLoading(false);
        }
    };

    const handleRestock = async () => {
        const qty = parseInt(restockQty);
        if (isNaN(qty) || qty <= 0) {
            toast.error('Enter a valid quantity to add');
            return;
        }

        setRestockLoading(true);
        try {
            const adminName = sessionStorage.getItem(storageKey('materials', 'adminName')) || 'Admin';
            await restockMaterial(restockMaterial_.id, qty, adminName, restockNotes.trim());
            toast.success(`Restocked ${qty} ${restockMaterial_.unit} of ${restockMaterial_.name}`);
            setRestockMaterial(null);
            setRestockQty('');
            setRestockNotes('');
            fetchMaterials();
        } catch (error) {
            toast.error(error.message || 'Restock failed');
        } finally {
            setRestockLoading(false);
        }
    };

    const lowStockCount = materials.filter(m => m.quantity > 0 && m.quantity <= LOW_STOCK_THRESHOLD).length;

    const fetchHistoryMap = async (materialList) => {
        const ids = materialList.map(m => m.id);
        if (!ids.length) return {};

        const { data, error } = await supabaseMaterials
            .from('material_history')
            .select('*')
            .in('material_id', ids)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const map = {};
        for (const entry of data || []) {
            if (!map[entry.material_id]) map[entry.material_id] = [];
            map[entry.material_id].push(entry);
        }
        return map;
    };

    const handlePrintConfirm = async () => {
        if (!printDialog) return;

        setPrintLoading(true);
        try {
            const mode = printDialog.mode;
            const material = printDialog.material;
            let history = [];
            let historyMap = {};
            let list = [];

            if (mode === 'single' && material) {
                if (printIncludeHistory) {
                    history = await fetchMaterialHistory(material.id);
                }
            } else {
                list = sortByRef(materials);
                if (!list.length) {
                    toast.error('No materials to print');
                    return;
                }
                if (printIncludeHistory) {
                    historyMap = await fetchHistoryMap(list);
                }
            }

            setPrintDialog(null);
            await new Promise((r) => setTimeout(r, 80));

            if (mode === 'single' && material) {
                printSingleMaterial(material, history, printIncludeHistory);
            } else {
                printAllMaterials(list, historyMap, printIncludeHistory);
            }
        } catch (error) {
            console.error('Print error:', error);
            toast.error(printFailureMessage(error));
        } finally {
            setPrintLoading(false);
        }
    };

    const openPrintDialog = (mode, material = null) => {
        setPrintIncludeHistory(true);
        setPrintDialog({ mode, material });
    };

    const counts = {
        total: materials.length,
        in: materials.filter((m) => stockStatus(m.quantity) === 'in').length,
        low: lowStockCount,
        out: materials.filter((m) => m.quantity === 0).length,
    };
    const shown = filteredMaterials.slice(0, visibleCount);
    const activeFilterCount = [searchTerm, stockFilter !== 'all', unitFilter !== 'all', sortMode !== 'reference'].filter(Boolean).length;
    const clearFilters = () => {
        setSearchTerm('');
        setStockFilter('all');
        setUnitFilter('all');
        setSortMode('reference');
    };
    const actionsFor = (material) => (
        <MaterialActions
            material={material}
            compact={compact}
            onHistory={() => openHistory(material)}
            onRestock={() => { setRestockMaterial(material); setRestockQty(''); setRestockNotes(''); }}
            onEdit={() => handleEdit(material)}
            onPrint={() => openPrintDialog('single', material)}
            onDelete={() => handleDelete(material)}
        />
    );
    const filterControls = (
        <>
            <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="stk-select" aria-label="Stock status"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All stock</SelectItem>
                    <SelectItem value="in">In stock</SelectItem>
                    <SelectItem value="low">Low stock</SelectItem>
                    <SelectItem value="out">Out of stock</SelectItem>
                </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger className="stk-select" aria-label="Unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All units</SelectItem>
                    {units.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={setSortMode}>
                <SelectTrigger className="stk-select stk-select--wide" aria-label="Sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="reference">Sort: Reference</SelectItem>
                    <SelectItem value="name">Sort: Name</SelectItem>
                    <SelectItem value="quantity-asc">Qty: Low to high</SelectItem>
                    <SelectItem value="quantity-desc">Qty: High to low</SelectItem>
                </SelectContent>
            </Select>
        </>
    );
    const historyStatus = historyMaterial ? stockStatus(historyMaterial.quantity) : 'in';

    return (
        <div className="stk">
            <SummaryTiles counts={counts} active={stockFilter} onPick={(key) => { setStockFilter(key); setVisibleCount(PAGE); }} />

            {/* Add new material */}
            <section className="stk-panel" aria-labelledby="stk-add-title">
                <button
                    type="button"
                    className="stk-panel__head stk-panel__head--toggle"
                    aria-expanded={addOpen}
                    aria-controls="stk-add-form"
                    onClick={() => setAddOpen((v) => !v)}
                >
                    <span className="stk-panel__icon" aria-hidden><Plus /></span>
                    <span className="min-w-0 flex-1 text-left">
                        <span id="stk-add-title" className="stk-panel__title">Add new material</span>
                        <span className="stk-panel__sub">Reference number and name are required</span>
                    </span>
                    <ChevronDown className={`stk-chev${addOpen ? ' is-open' : ''}`} aria-hidden />
                </button>
                <div className="stk-collapse" data-open={addOpen ? 'true' : 'false'}>
                    <div>
                        <form id="stk-add-form" onSubmit={handleAdd} className="stk-addform" noValidate>
                            <div className="stk-field">
                                <label htmlFor="stk-ref">Reference no. <span aria-hidden className="stk-req">*</span></label>
                                <Input
                                    id="stk-ref"
                                    placeholder="e.g. ADR100"
                                    value={addForm.reference_number}
                                    onChange={(e) => { setAddForm((p) => ({ ...p, reference_number: e.target.value })); setAddErrors((x) => ({ ...x, reference_number: '' })); }}
                                    className="font-mono"
                                    aria-required="true"
                                    aria-invalid={Boolean(addErrors.reference_number)}
                                    aria-describedby={addErrors.reference_number ? 'stk-ref-err' : undefined}
                                />
                                {addErrors.reference_number ? <p id="stk-ref-err" className="stk-err">{addErrors.reference_number}</p> : null}
                            </div>
                            <div className="stk-field stk-field--grow">
                                <label htmlFor="stk-name">Material name <span aria-hidden className="stk-req">*</span></label>
                                <Input
                                    id="stk-name"
                                    placeholder="e.g. Anchor drill bit 10 mm"
                                    value={addForm.name}
                                    onChange={(e) => { setAddForm((p) => ({ ...p, name: e.target.value })); setAddErrors((x) => ({ ...x, name: '' })); }}
                                    aria-required="true"
                                    aria-invalid={Boolean(addErrors.name)}
                                    aria-describedby={addErrors.name ? 'stk-name-err' : undefined}
                                />
                                {addErrors.name ? <p id="stk-name-err" className="stk-err">{addErrors.name}</p> : null}
                            </div>
                            <div className="stk-field">
                                <label htmlFor="stk-qty">Initial quantity</label>
                                <Input
                                    id="stk-qty"
                                    type="number"
                                    inputMode="numeric"
                                    min="0"
                                    placeholder="0"
                                    value={addForm.quantity}
                                    onChange={(e) => setAddForm((p) => ({ ...p, quantity: e.target.value }))}
                                />
                            </div>
                            <div className="stk-field">
                                <label htmlFor="stk-unit">Unit</label>
                                <Input
                                    id="stk-unit"
                                    placeholder="pcs"
                                    list="stk-units"
                                    value={addForm.unit}
                                    onChange={(e) => setAddForm((p) => ({ ...p, unit: e.target.value }))}
                                />
                                <datalist id="stk-units">
                                    {[...new Set(['pcs', 'set', 'm', 'box', ...units])].map((u) => <option key={u} value={u} />)}
                                </datalist>
                            </div>
                            <Button type="submit" disabled={isAdding} className="stk-btn-primary">
                                {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                <span>{isAdding ? 'Adding…' : 'Add material'}</span>
                            </Button>
                        </form>
                    </div>
                </div>
            </section>

            {/* Inventory */}
            <section className="stk-panel stk-panel--flush" aria-labelledby="stk-inv-title">
                <div className="stk-invhead">
                    <div className="min-w-0">
                        <h2 id="stk-inv-title" className="stk-panel__title">Materials inventory</h2>
                        <p className="stk-panel__sub">
                            {loadState === 'ready'
                                ? filteredMaterials.length === materials.length
                                    ? `${materials.length} materials`
                                    : `Showing ${filteredMaterials.length} of ${materials.length}`
                                : loadState === 'error' ? 'Could not load' : 'Loading…'}
                        </p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => openPrintDialog('all')}
                        disabled={materials.length === 0}
                        className="stk-btn-secondary"
                    >
                        <Printer className="h-4 w-4" /> <span>Print all</span>
                    </Button>
                </div>

                <div className="stk-toolbar">
                    <div className="stk-search">
                        <Search className="stk-search__icon" aria-hidden />
                        <Input
                            type="search"
                            placeholder="Search name or reference"
                            aria-label="Search materials by name or reference number"
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(PAGE); }}
                        />
                    </div>
                    {compact ? (
                        <button type="button" className="stk-filterbtn" onClick={() => setFiltersOpen(true)} aria-label={`Filters and sort${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}>
                            <SlidersHorizontal aria-hidden /> Filters
                            {activeFilterCount ? <span className="stk-filterbtn__n">{activeFilterCount}</span> : null}
                        </button>
                    ) : (
                        <>
                            {filterControls}
                            {hasFilters ? (
                                <Button type="button" variant="ghost" onClick={clearFilters} className="stk-btn-ghost">
                                    <X className="h-4 w-4" /> Clear
                                </Button>
                            ) : null}
                        </>
                    )}
                </div>
                {compact && hasFilters ? (
                    <div className="stk-chips">
                        {stockFilter !== 'all' ? <span className="stk-chip">{{ in: 'In stock', low: 'Low stock', out: 'Out of stock' }[stockFilter]}</span> : null}
                        {unitFilter !== 'all' ? <span className="stk-chip">Unit: {unitFilter}</span> : null}
                        {sortMode !== 'reference' ? <span className="stk-chip">{{ name: 'By name', 'quantity-asc': 'Qty low → high', 'quantity-desc': 'Qty high → low' }[sortMode]}</span> : null}
                        <button type="button" className="stk-chip stk-chip--clear" onClick={clearFilters}><X aria-hidden /> Clear</button>
                    </div>
                ) : null}

                {loadState === 'loading' ? (
                    <div className="stk-skeleton" aria-busy="true" aria-label="Loading materials">
                        {Array.from({ length: 6 }, (_, i) => <span key={i} className="g-skeleton" />)}
                    </div>
                ) : loadState === 'error' ? (
                    <div className="stk-empty" role="alert">
                        <AlertTriangle aria-hidden className="text-[var(--g-danger)]" />
                        <p className="stk-empty__title">Could not load materials</p>
                        <p className="stk-empty__text">Check your connection and try again.</p>
                        <Button type="button" variant="outline" className="stk-btn-secondary" onClick={fetchMaterials}>Try again</Button>
                    </div>
                ) : filteredMaterials.length === 0 ? (
                    <div className="stk-empty">
                        <Package aria-hidden />
                        <p className="stk-empty__title">{materials.length === 0 ? 'No materials yet' : 'No materials match'}</p>
                        <p className="stk-empty__text">
                            {materials.length === 0 ? 'Add your first material above.' : 'Try another search, or clear the filters.'}
                        </p>
                        {materials.length ? <Button type="button" variant="outline" className="stk-btn-secondary" onClick={clearFilters}>Clear filters</Button> : null}
                    </div>
                ) : compact ? (
                    <div className="stk-cards">
                        {shown.map((material) => (
                            <MaterialCard key={material.id} material={material} actions={actionsFor(material)} onOpen={() => openHistory(material)} />
                        ))}
                    </div>
                ) : (
                    <div className="stk-tablewrap">
                        <table className="stk-table">
                            <thead>
                                <tr>
                                    <th scope="col" className="w-[8.5rem]">Reference</th>
                                    <th scope="col">Material</th>
                                    <th scope="col" className="w-[7rem] text-right">Available</th>
                                    <th scope="col" className="w-[5rem]">Unit</th>
                                    <th scope="col" className="w-[9rem]">Status</th>
                                    <th scope="col" className="w-[10rem] text-right"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map((material) => {
                                    const status = stockStatus(material.quantity);
                                    return (
                                        <tr
                                            key={material.id}
                                            tabIndex={0}
                                            onClick={() => openHistory(material)}
                                            onKeyDown={(e) => {
                                                if (e.target !== e.currentTarget) return;
                                                if (e.key === 'Enter') openHistory(material);
                                            }}
                                            aria-label={`${material.name}: open history`}
                                        >
                                            <td><RefPill value={material.reference_number} /></td>
                                            <td><span className="stk-name" title={material.name}>{material.name}</span></td>
                                            <td className="text-right"><span className="stk-qty" data-status={status}>{material.quantity}</span></td>
                                            <td className="stk-unit">{material.unit}</td>
                                            <td><StatusBadge quantity={material.quantity} /></td>
                                            <td className="text-right">{actionsFor(material)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {loadState === 'ready' && filteredMaterials.length > shown.length ? (
                    <div className="stk-more">
                        <Button type="button" variant="outline" className="stk-btn-secondary" onClick={() => setVisibleCount((n) => n + PAGE)}>
                            Show {Math.min(PAGE, filteredMaterials.length - shown.length)} more
                        </Button>
                    </div>
                ) : null}
                <p className="stk-foot">
                    {compact ? 'Tap a material for its full history.' : 'Click a row (or press Enter) for its full history.'} Stock changes on take / return approval and restock.
                </p>
            </section>

            {/* Phone filters */}
            <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters & sort" subtitle={`${filteredMaterials.length} of ${materials.length} materials`}>
                <div className="stk-sheetfilters">{filterControls}</div>
                <div className="stk-sheetfilters__actions">
                    <Button type="button" variant="outline" className="stk-btn-secondary" onClick={clearFilters} disabled={!hasFilters}>Clear all</Button>
                    <Button type="button" className="stk-btn-primary" onClick={() => setFiltersOpen(false)}>Show {filteredMaterials.length}</Button>
                </div>
            </Sheet>

            {/* History drawer */}
            <Sheet
                open={!!historyMaterial}
                onClose={() => setHistoryMaterial(null)}
                title={historyMaterial?.name}
                subtitle={historyMaterial ? `#${historyMaterial.reference_number} · stock history, newest first` : undefined}
                className="stk-historysheet"
            >
                {historyMaterial ? (
                    <>
                        <div className="stk-histstats">
                            <div>
                                <p className="stk-card__label">Available</p>
                                <p className="stk-card__qty" data-status={historyStatus}>{historyMaterial.quantity} <span>{historyMaterial.unit}</span></p>
                            </div>
                            <StatusBadge quantity={historyMaterial.quantity} />
                        </div>
                        {historyLoading ? (
                            <div className="stk-skeleton" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <span key={i} className="g-skeleton" />)}</div>
                        ) : historyError ? (
                            <div className="stk-empty" role="alert">
                                <AlertTriangle aria-hidden className="text-[var(--g-danger)]" />
                                <p className="stk-empty__title">Could not load the history</p>
                                <Button type="button" variant="outline" className="stk-btn-secondary" onClick={() => openHistory(historyMaterial)}>Try again</Button>
                            </div>
                        ) : historyEntries.length === 0 ? (
                            <div className="stk-empty"><History aria-hidden /><p className="stk-empty__title">No history yet</p></div>
                        ) : (
                            <ol className="stk-moves">
                                {historyEntries.map((entry) => (
                                    <HistoryItem key={entry.id} entry={entry} unit={historyMaterial.unit} date={formatHistoryEntry(entry).date} />
                                ))}
                            </ol>
                        )}
                        <div className="stk-histactions">
                            <Button type="button" variant="outline" className="stk-btn-secondary" onClick={() => { const m = historyMaterial; setHistoryMaterial(null); openPrintDialog('single', m); }}>
                                <Printer className="h-4 w-4" /> Print
                            </Button>
                            <Button type="button" className="stk-btn-primary" onClick={() => { const m = historyMaterial; setHistoryMaterial(null); setRestockMaterial(m); setRestockQty(''); setRestockNotes(''); }}>
                                <ArrowUpCircle className="h-4 w-4" /> Restock
                            </Button>
                        </div>
                    </>
                ) : null}
            </Sheet>

            {/* Edit Dialog */}
            <Dialog open={!!editMaterial} onOpenChange={(open) => !open && setEditMaterial(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-[var(--g-brand)]" />
                            Edit Material
                        </DialogTitle>
                        <DialogDescription>
                            Update details for <strong>#{editMaterial?.reference_number} {editMaterial?.name}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleEditSave} className="space-y-4 py-2">
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-slate-700">Ref No. *</label>
                            <Input
                                value={editForm.reference_number}
                                onChange={(e) => setEditForm(p => ({ ...p, reference_number: e.target.value }))}
                                className="font-mono"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-slate-700">Name *</label>
                            <Input
                                value={editForm.name}
                                onChange={(e) => setEditForm(p => ({ ...p, name: e.target.value }))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-slate-700">Quantity</label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={editForm.quantity}
                                    onChange={(e) => setEditForm(p => ({ ...p, quantity: e.target.value }))}
                                />
                                <p className="text-xs text-slate-400">Changes are logged as adjustments</p>
                            </div>
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-slate-700">Unit</label>
                                <Input
                                    value={editForm.unit}
                                    onChange={(e) => setEditForm(p => ({ ...p, unit: e.target.value }))}
                                />
                            </div>
                        </div>
                        <DialogFooter className="gap-2 sm:gap-0 pt-2">
                            <Button type="button" variant="outline" onClick={() => setEditMaterial(null)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={editLoading} className="stk-btn-primary">
                                {editLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
                                Save Changes
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Print Dialog */}
            <Dialog open={!!printDialog} onOpenChange={(open) => !open && setPrintDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Printer className="w-5 h-5 text-[var(--g-brand)]" />
                            {printDialog?.mode === 'single' ? 'Print Material' : 'Print All Materials'}
                        </DialogTitle>
                        <DialogDescription>
                            {printDialog?.mode === 'single'
                                ? <>Print report for <strong>#{printDialog.material?.reference_number} {printDialog.material?.name}</strong></>
                                : <>Print report for all <strong>{materials.length}</strong> materials in inventory</>
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <p className="text-sm font-medium text-slate-700">Include movement history?</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setPrintIncludeHistory(true)}
                                className={`rounded-lg border-2 p-3 text-left transition-colors ${printIncludeHistory ? 'border-[var(--g-brand)] bg-[var(--g-brand-muted)]' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="text-sm font-semibold text-slate-800">With history</p>
                                <p className="text-xs text-slate-500 mt-1">Takes, returns, restocks & adjustments</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => setPrintIncludeHistory(false)}
                                className={`rounded-lg border-2 p-3 text-left transition-colors ${!printIncludeHistory ? 'border-[var(--g-brand)] bg-[var(--g-brand-muted)]' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="text-sm font-semibold text-slate-800">Summary only</p>
                                <p className="text-xs text-slate-500 mt-1">Ref, name, qty, unit & status</p>
                            </button>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setPrintDialog(null)}>Cancel</Button>
                        <Button onClick={handlePrintConfirm} disabled={printLoading} className="stk-btn-primary">
                            {printLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Printer className="w-4 h-4 mr-1" />}
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Restock Dialog */}
            <Dialog open={!!restockMaterial_} onOpenChange={(open) => !open && setRestockMaterial(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Restock Material</DialogTitle>
                        <DialogDescription>
                            Add stock to <strong>#{restockMaterial_?.reference_number} {restockMaterial_?.name}</strong>
                            (currently {restockMaterial_?.quantity} {restockMaterial_?.unit})
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Quantity to Add</label>
                            <Input
                                type="number" min="1"
                                placeholder="e.g. 10"
                                value={restockQty}
                                onChange={(e) => setRestockQty(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium">Notes (optional)</label>
                            <Input
                                placeholder="e.g. Delivery from supplier"
                                value={restockNotes}
                                onChange={(e) => setRestockNotes(e.target.value)}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRestockMaterial(null)}>Cancel</Button>
                        <Button onClick={handleRestock} disabled={restockLoading} className="stk-btn-success">
                            {restockLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowUpCircle className="w-4 h-4 mr-1" />}
                            Restock
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
