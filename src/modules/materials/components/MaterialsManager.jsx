import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabaseMaterials } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Badge } from '@/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { storageKey } from '@/core/storage'
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/dialog';
import {
    Pencil, Trash2, Plus, Check, Search, Package, History,
    ArrowUpCircle, AlertTriangle, Hash, Loader2, Printer, X
} from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import {
    fetchMaterialHistory, restockMaterial, logMaterialHistory,
    formatHistoryEntry, LOW_STOCK_THRESHOLD,
} from '@/modules/materials/lib/inventory';
import { printSingleMaterial, printAllMaterials } from '@/modules/materials/lib/materialPrint';
import { printFailureMessage } from '@/modules/materials/lib/printDocument';
import { filterAndSortMaterials } from '@/modules/materials/lib/materialFilters';

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

    // Edit dialog
    const [editMaterial, setEditMaterial] = useState(null);
    const [editForm, setEditForm] = useState({ reference_number: '', name: '', quantity: '', unit: 'pcs' });
    const [editLoading, setEditLoading] = useState(false);

    // History dialog
    const [historyMaterial, setHistoryMaterial] = useState(null);
    const [historyEntries, setHistoryEntries] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

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
            const { data, error } = await supabaseMaterials
                .from('materials_catalog')
                .select('*');
            if (error) throw error;
            setMaterials(sortByRef(data || []));
        } catch (error) {
            console.error('Error fetching materials:', error);
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
            toast.error('Reference number and name are required');
            return;
        }

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
        try {
            const entries = await fetchMaterialHistory(material.id);
            setHistoryEntries(entries);
        } catch {
            toast.error('Failed to load history');
            setHistoryEntries([]);
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

    return (
        <motion.div className="space-y-6">
            {/* Summary cards */}
            <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="border-slate-200">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-slate-800">{materials.length}</p>
                        <p className="text-xs text-slate-500 mt-1">Total Materials</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-green-600">
                            {materials.filter(m => m.quantity > LOW_STOCK_THRESHOLD).length}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">In Stock</p>
                    </CardContent>
                </Card>
                <Card className={`border ${lowStockCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                    <CardContent className="p-4 text-center">
                        <p className={`text-2xl font-bold ${lowStockCount > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {lowStockCount}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Low Stock</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200">
                    <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-red-500">
                            {materials.filter(m => m.quantity === 0).length}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Out of Stock</p>
                    </CardContent>
                </Card>
            </motion.div>

            {/* Add form */}
            <Card className="border-slate-200">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Package className="w-5 h-5 text-[#dc6b2f]" />
                        Add New Material
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Ref No. *</label>
                            <Input
                                placeholder="e.g. 1001"
                                value={addForm.reference_number}
                                onChange={(e) => setAddForm(p => ({ ...p, reference_number: e.target.value }))}
                                className="font-mono"
                            />
                        </div>
                        <motion.div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Name *</label>
                            <Input
                                placeholder="Material name"
                                value={addForm.name}
                                onChange={(e) => setAddForm(p => ({ ...p, name: e.target.value }))}
                            />
                        </motion.div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Initial Qty</label>
                            <Input
                                type="number"
                                min="0"
                                placeholder="0"
                                value={addForm.quantity}
                                onChange={(e) => setAddForm(p => ({ ...p, quantity: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-600">Unit</label>
                            <Input
                                placeholder="pcs"
                                value={addForm.unit}
                                onChange={(e) => setAddForm(p => ({ ...p, unit: e.target.value }))}
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button type="submit" disabled={isAdding} className="bg-slate-700 hover:bg-slate-800 flex-1">
                                {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                <span className="ml-1">Add</span>
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {/* Materials list */}
            <Card className="border-slate-200">
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            Materials Inventory
                            <Badge variant="outline" className="font-normal">
                                {filteredMaterials.length} / {materials.length}
                            </Badge>
                        </CardTitle>
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => openPrintDialog('all')}
                                disabled={materials.length === 0}
                                className="shrink-0 border-slate-300"
                            >
                                <Printer className="w-4 h-4 mr-2" />
                                Print All
                            </Button>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    placeholder="Search by name or ref..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9"
                                />
                            </div>
                            <Select value={stockFilter} onValueChange={setStockFilter}>
                                <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All stock</SelectItem>
                                    <SelectItem value="in">In stock</SelectItem>
                                    <SelectItem value="low">Low stock</SelectItem>
                                    <SelectItem value="out">Out of stock</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={unitFilter} onValueChange={setUnitFilter}>
                                <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All units</SelectItem>
                                    {units.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Select value={sortMode} onValueChange={setSortMode}>
                                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="reference">Sort: Reference</SelectItem>
                                    <SelectItem value="name">Sort: Name</SelectItem>
                                    <SelectItem value="quantity-asc">Qty: Low to high</SelectItem>
                                    <SelectItem value="quantity-desc">Qty: High to low</SelectItem>
                                </SelectContent>
                            </Select>
                            {hasFilters && (
                                <Button type="button" variant="ghost" onClick={() => {
                                    setSearchTerm('');
                                    setStockFilter('all');
                                    setUnitFilter('all');
                                    setSortMode('reference');
                                }}>
                                    <X className="mr-1 h-4 w-4" />Clear
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="w-24">Ref No.</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead className="w-24 text-center">Qty</TableHead>
                                    <TableHead className="w-20">Unit</TableHead>
                                    <TableHead className="w-28">Status</TableHead>
                                    <TableHead className="w-52 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredMaterials.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-10 text-slate-400">
                                            {materials.length === 0
                                                ? 'No materials yet. Add your first material above.'
                                                : 'No materials match the active filters.'}
                                        </TableCell>
                                    </TableRow>
                                ) : filteredMaterials.map((material) => {
                                    const isLow = material.quantity <= LOW_STOCK_THRESHOLD && material.quantity > 0;
                                    const isOut = material.quantity === 0;

                                    return (
                                        <TableRow
                                            key={material.id}
                                            className="cursor-pointer hover:bg-slate-50"
                                            onClick={() => openHistory(material)}
                                        >
                                            <TableCell>
                                                <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded">
                                                    #{material.reference_number}
                                                </span>
                                            </TableCell>
                                            <TableCell className="font-medium">{material.name}</TableCell>
                                            <TableCell className="text-center">
                                                <span className={`font-bold ${isOut ? 'text-red-500' : isLow ? 'text-amber-600' : 'text-green-600'}`}>
                                                    {material.quantity}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-slate-500">{material.unit}</TableCell>
                                            <TableCell>
                                                {isOut ? (
                                                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Out of Stock</Badge>
                                                ) : isLow ? (
                                                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                                                        <AlertTriangle className="w-3 h-3 mr-1" />Low
                                                    </Badge>
                                                ) : (
                                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">In Stock</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <motion.div className="inline-flex justify-end gap-0.5 rounded-lg border border-border bg-muted/50 p-1" onClick={(e) => e.stopPropagation()}>
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                                                        title="Print"
                                                        onClick={() => openPrintDialog('single', material)}
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-8 w-8 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                                        title="View history"
                                                        onClick={() => openHistory(material)}
                                                    >
                                                        <History className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-8 w-8 text-green-600 hover:text-green-800 hover:bg-green-50"
                                                        title="Restock"
                                                        onClick={() => { setRestockMaterial(material); setRestockQty(''); setRestockNotes(''); }}
                                                    >
                                                        <ArrowUpCircle className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-8 w-8 text-slate-600 hover:text-slate-800"
                                                        title="Edit"
                                                        onClick={() => handleEdit(material)}
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost" size="icon"
                                                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                                        title="Delete"
                                                        onClick={() => handleDelete(material)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </motion.div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                    <p className="text-xs text-slate-400 px-4 py-3 border-t">
                        Click a row to view full history. Stock changes on take/return approval and restock.
                    </p>
                </CardContent>
            </Card>

            {/* History Dialog */}
            <Dialog open={!!historyMaterial} onOpenChange={(open) => !open && setHistoryMaterial(null)}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Hash className="w-5 h-5 text-[#dc6b2f]" />
                            #{historyMaterial?.reference_number} — {historyMaterial?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Current stock: <strong>{historyMaterial?.quantity} {historyMaterial?.unit}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto space-y-2 py-2">
                        {historyLoading ? (
                            <motion.div className="flex justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                            </motion.div>
                        ) : historyEntries.length === 0 ? (
                            <p className="text-center text-slate-400 py-8 text-sm">No history yet.</p>
                        ) : historyEntries.map((entry) => {
                            const fmt = formatHistoryEntry(entry);
                            const colorMap = {
                                orange: 'border-l-orange-400 bg-orange-50',
                                green: 'border-l-green-400 bg-green-50',
                                blue: 'border-l-blue-400 bg-blue-50',
                                slate: 'border-l-slate-400 bg-slate-50',
                            };
                            return (
                                <div
                                    key={entry.id}
                                    className={`border-l-4 rounded-r-lg px-3 py-2 text-sm ${colorMap[fmt.color] || colorMap.slate}`}
                                >
                                    <p className="font-medium text-slate-800">{fmt.text}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{fmt.date}</p>
                                </div>
                            );
                        })}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={!!editMaterial} onOpenChange={(open) => !open && setEditMaterial(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-[#dc6b2f]" />
                            Edit Material
                        </DialogTitle>
                        <DialogDescription>
                            Update details for <strong>#{editMaterial?.reference_number} {editMaterial?.name}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleEditSave} className="space-y-4 py-2">
                        <motion.div className="space-y-1">
                            <label className="text-sm font-medium text-slate-700">Ref No. *</label>
                            <Input
                                value={editForm.reference_number}
                                onChange={(e) => setEditForm(p => ({ ...p, reference_number: e.target.value }))}
                                className="font-mono"
                            />
                        </motion.div>
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
                            <Button type="submit" disabled={editLoading} className="bg-slate-700 hover:bg-slate-800">
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
                            <Printer className="w-5 h-5 text-[#dc6b2f]" />
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
                                className={`rounded-lg border-2 p-3 text-left transition-colors ${printIncludeHistory ? 'border-[#dc6b2f] bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="text-sm font-semibold text-slate-800">With history</p>
                                <p className="text-xs text-slate-500 mt-1">Takes, returns, restocks & adjustments</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => setPrintIncludeHistory(false)}
                                className={`rounded-lg border-2 p-3 text-left transition-colors ${!printIncludeHistory ? 'border-[#dc6b2f] bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}
                            >
                                <p className="text-sm font-semibold text-slate-800">Summary only</p>
                                <p className="text-xs text-slate-500 mt-1">Ref, name, qty, unit & status</p>
                            </button>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={() => setPrintDialog(null)}>Cancel</Button>
                        <Button onClick={handlePrintConfirm} disabled={printLoading} className="bg-slate-700 hover:bg-slate-800">
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
                        <Button onClick={handleRestock} disabled={restockLoading} className="bg-green-600 hover:bg-green-700">
                            {restockLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowUpCircle className="w-4 h-4 mr-1" />}
                            Restock
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </motion.div>
    );
}
