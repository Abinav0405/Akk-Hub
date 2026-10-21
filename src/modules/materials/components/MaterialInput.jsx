import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Plus, Trash2, Hash, Package, AlertCircle } from "lucide-react";
import { fetchMaterialsCatalog, fetchPendingTakeQuantities } from '@/modules/materials/lib/inventory';

export default function MaterialInput({ materials, setMaterials, isReturn = false, editMode = false, excludeTransactionId = null }) {
    const [catalog, setCatalog] = useState([]);
    const [pendingReserved, setPendingReserved] = useState({});
    const [loadingCatalog, setLoadingCatalog] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (isReturn) return;

        const load = async () => {
            setLoadingCatalog(true);
            try {
                const [items, pending] = await Promise.all([
                    fetchMaterialsCatalog(),
                    fetchPendingTakeQuantities(excludeTransactionId),
                ]);
                setCatalog(items);
                setPendingReserved(pending);
            } catch (err) {
                console.error('Failed to load catalog:', err);
            } finally {
                setLoadingCatalog(false);
            }
        };
        load();
    }, [isReturn, excludeTransactionId]);

  // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setActiveDropdown(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const getAvailable = (catalogItem, excludeIndex = null) => {
        const reserved = pendingReserved[catalogItem.id] || 0;
        // Subtract qty already selected in this form for same material, excluding the current row
        const inForm = materials
            .filter((m, i) => m.material_id === catalogItem.id && i !== excludeIndex)
            .reduce((sum, m) => sum + (parseInt(m.quantity) || 0), 0);
        return Math.max(0, catalogItem.quantity - reserved - inForm);
    };

    /** Full catalog for the open row: search filters; OOS shown (disabled); already-selected excluded. */
    const getSuggestions = (query, index) => {
        const q = (query || '').toLowerCase().trim();
        const selectedIds = new Set(
            materials.filter((_, i) => i !== index).map(m => m.material_id).filter(Boolean)
        );

        const matched = catalog.filter((item) => {
            if (selectedIds.has(item.id)) return false;
            if (!q) return true;
            return (
                (item.name || '').toLowerCase().includes(q) ||
                String(item.reference_number ?? '').toLowerCase().includes(q)
            );
        });

        // In-stock first, then out of stock — preserve catalog (ref) order within each group
        return matched.sort((a, b) => {
            const aStock = getAvailable(a, index) > 0 ? 0 : 1;
            const bStock = getAvailable(b, index) > 0 ? 0 : 1;
            return aStock - bStock;
        });
    };

    const selectCatalogItem = (index, item) => {
        const available = getAvailable(item, index);
        if (available <= 0) return;
        const updated = [...materials];
        updated[index] = {
            material_id: item.id,
            reference_number: item.reference_number,
            name: item.name,
            unit: item.unit,
            quantity: 1,
            max_available: available,
            from_catalog: true,
        };
        setMaterials(updated);
        setActiveDropdown(null);
    };

    const addMaterial = () => {
        setMaterials([...materials, { name: '', quantity: 1, unit: 'pcs' }]);
    };

    const removeMaterial = (index) => {
        if (materials.length <= 1) return;
        setMaterials(materials.filter((_, i) => i !== index));
    };

    const updateMaterial = (index, field, value) => {
        const updated = [...materials];
        updated[index] = { ...updated[index], [field]: value };

        // Recompute max when qty changes
        if (field === 'quantity' && updated[index].material_id) {
            const item = catalog.find(c => c.id === updated[index].material_id);
            if (item) {
                const othersInForm = materials
                    .filter((_, i) => i !== index && materials[i].material_id === item.id)
                    .reduce((sum, m) => sum + (parseInt(m.quantity) || 0), 0);
                const reserved = pendingReserved[item.id] || 0;
                updated[index].max_available = Math.max(0, item.quantity - reserved - othersInForm);
            }
        }

        setMaterials(updated);
    };

    if (isReturn) {
        // Return mode uses MaterialForm's own return UI — this shouldn't render
        return null;
    }

    return (
        <div className="space-y-3 relative z-10">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">Materials List</label>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addMaterial}
                    className="text-[#1e3a5f] border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5"
                >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Item
                </Button>
            </div>

            {loadingCatalog && (
                <p className="text-xs text-slate-400">Loading materials catalog…</p>
            )}

            {!loadingCatalog && catalog.length === 0 && !editMode && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>No materials in catalog. Ask admin to add materials first.</span>
                </div>
            )}

            <div className="space-y-3">
                {materials.map((material, index) => {
                    const suggestions = activeDropdown === index
                        ? getSuggestions(material.name, index)
                        : [];
                    const isFromCatalog = material.from_catalog || material.material_id;
                    const showDropdown = activeDropdown === index && !isFromCatalog && !loadingCatalog;

                    return (
                        <div
                            key={material.material_id || `row-${index}`}
                            className="relative space-y-2 rounded-xl border border-slate-200 bg-white p-3"
                        >
                            {/* Search — full width so dropdown is readable on phone */}
                            <div className="relative w-full" ref={activeDropdown === index ? dropdownRef : null}>
                                <Input
                                    placeholder="Search or browse materials…"
                                    value={material.name}
                                    onChange={(e) => {
                                        updateMaterial(index, 'name', e.target.value);
                                        if (!isFromCatalog) setActiveDropdown(index);
                                    }}
                                    onFocus={() => !isFromCatalog && setActiveDropdown(index)}
                                    readOnly={!!isFromCatalog && !editMode}
                                    className={`border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 ${isFromCatalog ? 'bg-slate-50' : ''}`}
                                    autoComplete="off"
                                />

                                {showDropdown && (
                                    <div
                                        className="akk-scroll-y absolute z-[60] top-full left-0 right-0 mt-1 max-h-[min(50vh,20rem)] overscroll-contain touch-pan-y rounded-lg border border-slate-200 bg-white shadow-xl"
                                        role="listbox"
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        {suggestions.length === 0 ? (
                                            <p className="px-3 py-3 text-sm text-slate-400">
                                                {catalog.length === 0
                                                    ? 'No materials in catalog'
                                                    : 'No matching materials'}
                                            </p>
                                        ) : (
                                            <>
                                                {suggestions.map((item) => {
                                                    const avail = getAvailable(item, index);
                                                    const outOfStock = avail <= 0;
                                                    return (
                                                        <button
                                                            key={item.id}
                                                            type="button"
                                                            role="option"
                                                            aria-disabled={outOfStock}
                                                            disabled={outOfStock}
                                                            onClick={() => selectCatalogItem(index, item)}
                                                            className={`w-full block px-3 py-3 text-left border-b border-slate-100 last:border-0 ${
                                                                outOfStock
                                                                    ? 'bg-slate-50 cursor-not-allowed'
                                                                    : 'bg-white active:bg-slate-100 hover:bg-slate-100 cursor-pointer'
                                                            }`}
                                                        >
                                                            {/* Stacked layout — avoids sideways crush / overlap on narrow screens */}
                                                            <div className="flex items-start justify-between gap-3">
                                                                <span className={`font-mono text-xs font-semibold px-2 py-1 rounded shrink-0 ${
                                                                    outOfStock
                                                                        ? 'bg-slate-100 text-slate-400'
                                                                        : 'bg-slate-100 text-slate-700'
                                                                }`}>
                                                                    #{item.reference_number}
                                                                </span>
                                                                {outOfStock ? (
                                                                    <span className="text-xs font-medium text-slate-400 shrink-0 pt-0.5">
                                                                        Out of stock
                                                                    </span>
                                                                ) : (
                                                                    <span className={`text-xs font-semibold shrink-0 pt-0.5 ${
                                                                        avail <= 3 ? 'text-amber-600' : 'text-green-600'
                                                                    }`}>
                                                                        {avail} {item.unit}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className={`mt-1.5 text-sm font-medium leading-snug break-words ${
                                                                outOfStock ? 'text-slate-400' : 'text-slate-800'
                                                            }`}>
                                                                {item.name}
                                                            </p>
                                                        </button>
                                                    );
                                                })}
                                                <div className="sticky bottom-0 px-3 py-2 text-[11px] text-slate-500 bg-white border-t border-slate-100">
                                                    {suggestions.length} material{suggestions.length === 1 ? '' : 's'}
                                                    {(material.name || '').trim()
                                                        ? ' matching'
                                                        : ' in catalog'}
                                                    {' · scroll for more'}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {material.reference_number && (
                                    <Badge variant="outline" className="font-mono text-xs whitespace-nowrap">
                                        <Hash className="w-3 h-3 mr-1" />
                                        {material.reference_number}
                                    </Badge>
                                )}
                                <Input
                                    type="number"
                                    min="1"
                                    max={material.max_available || undefined}
                                    placeholder="QTY"
                                    value={material.quantity || ''}
                                    onChange={(e) => {
                                        const inputValue = e.target.value;
                                        if (inputValue === '') {
                                            updateMaterial(index, 'quantity', '');
                                        } else {
                                            const parsed = parseInt(inputValue);
                                            updateMaterial(index, 'quantity', isNaN(parsed) ? '' : parsed);
                                        }
                                    }}
                                    className="w-20 border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                                />
                                <Input
                                    placeholder="Unit"
                                    value={material.unit}
                                    onChange={(e) => updateMaterial(index, 'unit', e.target.value)}
                                    readOnly={!!isFromCatalog}
                                    className={`w-16 border-slate-200 text-sm ${isFromCatalog ? 'bg-slate-50' : ''}`}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeMaterial(index)}
                                    disabled={materials.length <= 1}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0 disabled:opacity-30 ml-auto"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {materials.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                    <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No materials added yet</p>
                    <Button type="button" variant="link" onClick={addMaterial} className="text-[#f97316] mt-1">
                        Add your first item
                    </Button>
                </div>
            )}
        </div>
    );
}
