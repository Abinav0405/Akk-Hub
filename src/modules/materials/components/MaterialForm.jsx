import React, { useState, useEffect } from 'react';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { storageKey } from '@/core/storage'
import {
    ArrowLeft, Send, Package, RotateCcw, Loader2,
    ChevronDown, ChevronUp, CheckCircle, PlusCircle, X, Trash2, MapPin, AlertCircle
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { nowDisplayDateTime, todayIsoDate } from '@/modules/materials/lib/dates';
import MaterialInput from "./MaterialInput";
import { supabaseMaterials } from '@/core/supabase'
import { toast } from "sonner";
import {
    getAvailableQuantity,
    getOutstandingReturnQty,
    getWorkerOutstandingReturns,
    parseQty,
    parseReturnQty,
} from '@/modules/materials/lib/inventory';
import { getWorkerSession } from '@/core/auth/materialsSession';
import { isNativeApp } from '@/core/platform';

export default function MaterialForm({ type, onBack, onSuccess, editMode = false, existingTransaction = null, onDelete = null }) {
    const isReturn = type === 'return';
    const native = isNativeApp();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState(
        editMode && existingTransaction ? {
            worker_name: existingTransaction.worker_name || '',
            worker_id: existingTransaction.worker_id || '',
            transaction_date: existingTransaction.transaction_date || todayIsoDate(),
            transaction_time: existingTransaction.transaction_time || format(new Date(), 'HH:mm'),
            site_id: existingTransaction.site_id || '',
            site_name: existingTransaction.site_name || '',
            notes: existingTransaction.notes || ''
        } : {
            worker_name: sessionStorage.getItem(storageKey('materials', 'workerName')) || sessionStorage.getItem(storageKey('materials', 'adminName')) || '',
            worker_id: sessionStorage.getItem(storageKey('materials', 'workerId')) || '',
            transaction_date: todayIsoDate(),
            transaction_time: format(new Date(), 'HH:mm'),
            site_id: '',
            site_name: '',
            notes: ''
        }
    );

    const workerSession = getWorkerSession();
    const workerFieldsLocked = !!workerSession;

    const [sites, setSites] = useState([]);
    const [loadingSites, setLoadingSites] = useState(true);

    useEffect(() => {
        const fetchSites = async () => {
            setLoadingSites(true);
            try {
                const { data, error } = await supabaseMaterials
                    .from('sites')
                    .select('*')
                    .order('name', { ascending: true });
                if (error) throw error;
                setSites(data || []);
            } catch (err) {
                console.error('Error fetching sites:', err);
            } finally {
                setLoadingSites(false);
            }
        };
        fetchSites();
    }, []);

    const [materials, setMaterials] = useState(
        editMode && existingTransaction?.materials?.length > 0
            ? existingTransaction.materials
            : isReturn
            ? [{ name: '', quantity: 1, unit: 'pcs', reference_number: '' }]
            : [{ name: '', quantity: 1, unit: 'pcs' }]
    );

    // ── Returnable Items Picker state ────────────────────────────────────────
    const [returnableItems, setReturnableItems] = useState([]);
    const [loadingReturnableItems, setLoadingReturnableItems] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(true);

    useEffect(() => {
        if (!isReturn) return;

        const fetchReturnableItems = async () => {
            const currentWorkerId = workerSession?.workerId || formData.worker_id;
            if (!currentWorkerId) return;

            setLoadingReturnableItems(true);
            try {
                const items = await getWorkerOutstandingReturns(
                    currentWorkerId,
                    editMode ? existingTransaction?.id : null,
                    workerSession?.token || null
                );
                setReturnableItems(items);
            } catch (err) {
                console.error('Error fetching returnable items:', err);
            } finally {
                setLoadingReturnableItems(false);
            }
        };

        fetchReturnableItems();
    }, [isReturn, editMode, existingTransaction?.id, workerSession?.workerId, formData.worker_id]);

    // Add a returnable item from the picker into the materials list
    const selectReturnableItem = (item) => {
        const alreadySelected = materials.some(
            m => m.reference_number === item.reference_number
        );
        if (alreadySelected) return;

        const newMaterial = {
            material_id: item.material_id,
            reference_number: item.reference_number,
            name: item.name,
            quantity: item.quantity,
            available_quantity: item.available_quantity,
            unit: item.unit,
            loading: false,
            error: '',
        };

        // Replace the first empty row, or append
        const emptyIndex = materials.findIndex(m => !m.reference_number && !m.name);
        if (emptyIndex >= 0) {
            const updated = [...materials];
            updated[emptyIndex] = newMaterial;
            setMaterials(updated);
        } else {
            setMaterials(prev => [...prev, newMaterial]);
        }
    };

    // ── Reference number auto-fill ───────────────────────────────────────────
    const handleReferenceNumberChange = async (index, referenceNumber) => {
        const updated = [...materials];
        updated[index] = { ...updated[index], reference_number: referenceNumber, loading: true, error: '' };
        setMaterials(updated);

        if (referenceNumber.trim() && isReturn) {
            try {
                const currentWorkerId = workerSession?.workerId || sessionStorage.getItem(storageKey('materials', 'workerId'));

                if (!currentWorkerId) {
                    toast.error('User session expired. Please log in again.');
                    updated[index] = { ...updated[index], name: '', quantity: 1, available_quantity: 0, unit: 'pcs', loading: false, error: 'Please log in again' };
                    setMaterials(updated);
                    return;
                }

                const { totalTaken, available, material: foundMaterial } = await getOutstandingReturnQty({
                    workerId: currentWorkerId,
                    referenceNumber: referenceNumber.trim(),
                    excludeTransactionId: editMode ? existingTransaction?.id : null,
                    token: workerSession?.token || null,
                });

                if (foundMaterial && totalTaken > 0) {
                    updated[index] = {
                        ...updated[index],
                        material_id: foundMaterial.material_id,
                        name: foundMaterial.name,
                        quantity: totalTaken,
                        available_quantity: available,
                        unit: foundMaterial.unit,
                        reference_number: referenceNumber.trim(),
                        loading: false,
                        error: available === 0 ? 'This material has already been fully returned' : '',
                    };
                    setMaterials(updated);
                } else {
                    updated[index] = { ...updated[index], name: '', quantity: 1, available_quantity: 0, unit: 'pcs', loading: false, error: 'Reference number not found in your take records' };
                    setMaterials(updated);
                }
            } catch (error) {
                console.error('Error fetching material details:', error);
                updated[index] = { ...updated[index], loading: false, error: 'Error loading material details' };
                setMaterials(updated);
            }
        } else {
            updated[index] = { ...updated[index], name: '', quantity: 1, available_quantity: 0, unit: 'pcs', loading: false, error: '' };
            setMaterials(updated);
        }
    };

    const addReferenceNumberInput = () => {
        setMaterials(prev => [...prev, { name: '', quantity: 1, unit: 'pcs', reference_number: '' }]);
    };

    const removeReferenceNumberInput = (index) => {
        if (materials.length > 1) {
            setMaterials(materials.filter((_, i) => i !== index));
        }
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSiteChange = (siteId) => {
        const site = sites.find(s => s.id === siteId);
        setFormData(prev => ({
            ...prev,
            site_id: siteId,
            site_name: site?.name || '',
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.worker_name.trim() || !formData.worker_id.trim()) {
            toast.error('Please fill in worker name and ID');
            return;
        }

        if (!formData.site_id) {
            toast.error('Please select a site');
            return;
        }

        const validMaterials = materials.filter(m => m.name.trim());
        if (validMaterials.length === 0) {
            toast.error('Please add at least one material');
            return;
        }

        setIsSubmitting(true);

        try {
            let processedMaterials = validMaterials;

            if (type === 'take') {
                const ids = validMaterials.map(m => m.material_id).filter(Boolean);
                if (new Set(ids).size !== ids.length) {
                    toast.error('Duplicate materials in request. Combine quantities into one line.');
                    setIsSubmitting(false);
                    return;
                }

                for (const material of validMaterials) {
                    if (!material.material_id) {
                        toast.error(`"${material.name}" must be selected from the catalog`);
                        setIsSubmitting(false);
                        return;
                    }

                    const qty = parseQty(material.quantity);
                    if (qty < 1) {
                        toast.error(`Enter a valid quantity for ${material.name}`);
                        setIsSubmitting(false);
                        return;
                    }

                    const available = await getAvailableQuantity(
                        material.material_id,
                        editMode ? existingTransaction?.id : null
                    );
                    if (qty > available) {
                        toast.error(`Insufficient stock for ${material.name}. Only ${available} available.`);
                        setIsSubmitting(false);
                        return;
                    }
                }

                processedMaterials = validMaterials.map(material => {
                    const qty = parseQty(material.quantity) || 1;
                    return {
                        material_id: material.material_id,
                        reference_number: material.reference_number,
                        name: material.name,
                        quantity: qty,
                        unit: material.unit || 'pcs',
                        returned: false,
                        returned_quantity: 0,
                        return_date: null,
                        return_declined: false,
                        return_declined_by: null,
                        return_declined_date: null,
                        taken_date: nowDisplayDateTime(),
                    };
                });
            }

            if (type === 'return') {
                const validReferenceNumbers = materials
                    .map(m => m.reference_number?.trim())
                    .filter(ref => ref);

                if (validReferenceNumbers.length === 0) {
                    toast.error('Please select or enter at least one reference number');
                    setIsSubmitting(false);
                    return;
                }

                const currentWorkerId = workerSession?.workerId || formData.worker_id;
                if (!currentWorkerId) {
                    toast.error('Session expired. Please log in again.');
                    setIsSubmitting(false);
                    return;
                }

                const returnMaterials = [];

                for (const materialInput of materials) {
                    const referenceNumber = materialInput.reference_number?.trim();
                    if (!referenceNumber || !materialInput.name) continue;

                    const returnQty = parseReturnQty(materialInput.return_quantity);
                    if (returnQty < 1) {
                        toast.error(`Please enter a valid return quantity for ${materialInput.name}`);
                        setIsSubmitting(false);
                        return;
                    }

                    const { totalTaken, available } = await getOutstandingReturnQty({
                        workerId: currentWorkerId,
                        referenceNumber,
                        excludeTransactionId: editMode ? existingTransaction?.id : null,
                        token: workerSession?.token || null,
                    });

                    if (totalTaken === 0) {
                        toast.error(`Reference #${referenceNumber} not found in your take history`);
                        setIsSubmitting(false);
                        return;
                    }

                    if (returnQty > available) {
                        toast.error(`Cannot return ${returnQty} ${materialInput.unit || 'units'} of ${materialInput.name}. Only ${available} available to return.`);
                        setIsSubmitting(false);
                        return;
                    }

                    returnMaterials.push({
                        material_id: materialInput.material_id,
                        reference_number: referenceNumber,
                        name: materialInput.name,
                        unit: materialInput.unit,
                        quantity: totalTaken,
                        return_quantity: returnQty,
                    });
                }

                processedMaterials = returnMaterials;
            }

            if (editMode && existingTransaction) {
                if (workerSession?.token) {
                    // Worker (anon) path: routed through a SECURITY DEFINER RPC that
                    // re-checks ownership + pending status server-side (SEC-09).
                    const { error } = await supabaseMaterials.rpc('update_pending_transaction', {
                        p_token: workerSession.token,
                        p_transaction_id: existingTransaction.id,
                        p_materials: processedMaterials,
                        p_notes: formData.notes,
                        p_site_id: formData.site_id,
                        p_site_name: formData.site_name,
                        p_transaction_date: formData.transaction_date,
                        p_transaction_time: formData.transaction_time,
                    });
                    if (error) throw error;
                } else {
                    // Staff (authenticated) path: RLS already scopes this via is_staff().
                    const updatedTransaction = { ...formData, materials: processedMaterials };
                    const { error } = await supabaseMaterials
                        .from('transactions')
                        .update(updatedTransaction)
                        .eq('id', existingTransaction.id);

                    if (error) throw error;
                }

                toast.success('Request updated successfully!');
            } else {
                if (!workerSession?.token) {
                    toast.error('Session expired. Please log in again.');
                    setIsSubmitting(false);
                    return;
                }

                // Worker identity (name/id) is derived server-side from the session
                // token, not from these editable form fields (SEC-14).
                const { error } = await supabaseMaterials.rpc('create_material_transaction', {
                    p_token: workerSession.token,
                    p_transaction_type: type,
                    p_materials: processedMaterials,
                    p_notes: formData.notes,
                    p_site_id: formData.site_id,
                    p_site_name: formData.site_name,
                    p_transaction_date: formData.transaction_date,
                    p_transaction_time: formData.transaction_time,
                });

                if (error) throw error;

                toast.success('Request submitted successfully! Awaiting approval.');
            }
            onSuccess();
        } catch (error) {
            console.error('Error submitting request:', error);
            toast.error(editMode ? 'Failed to update request' : 'Failed to submit request');
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Helpers ──────────────────────────────────────────────────────────────
    const selectedRefNumbers = new Set(
        materials.map(m => m.reference_number).filter(Boolean)
    );

    const formBody = (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Worker Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Worker Name</label>
                    <Input
                        placeholder="Enter full name"
                        value={formData.worker_name}
                        onChange={(e) => handleInputChange('worker_name', e.target.value)}
                        readOnly={workerFieldsLocked}
                        className={`border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 ${workerFieldsLocked ? 'bg-slate-50' : ''}`}
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Worker ID</label>
                    <Input
                        placeholder="Enter ID number"
                        value={formData.worker_id}
                        onChange={(e) => handleInputChange('worker_id', e.target.value)}
                        readOnly={workerFieldsLocked}
                        className={`border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 ${workerFieldsLocked ? 'bg-slate-50' : ''}`}
                    />
                </div>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Date</label>
                    <Input
                        type="date"
                        value={formData.transaction_date}
                        onChange={(e) => handleInputChange('transaction_date', e.target.value)}
                        className="border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Time</label>
                    <Input
                        type="time"
                        value={formData.transaction_time}
                        onChange={(e) => handleInputChange('transaction_time', e.target.value)}
                        className="border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20"
                    />
                </div>
            </div>

            {/* Site */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-[#dc6b2f]" />
                    Site *
                </label>
                {loadingSites ? (
                    <motion.div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading sites…
                    </motion.div>
                ) : sites.length === 0 ? (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>No sites available. Ask admin to add sites first.</span>
                    </div>
                ) : (
                    <Select
                        value={formData.site_id || undefined}
                        onValueChange={handleSiteChange}
                    >
                        <SelectTrigger className="border-slate-200 focus:ring-[#1e3a5f]/20">
                            <SelectValue placeholder="Select a site…" />
                        </SelectTrigger>
                        <SelectContent>
                            {sites.map((site) => (
                                <SelectItem key={site.id} value={site.id}>
                                    {site.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {formData.site_name && (
                    <p className="text-xs text-slate-500">
                        {isReturn ? 'Returning to' : 'Taking to'}: <strong>{formData.site_name}</strong>
                    </p>
                )}
            </div>

            {/* Materials section */}
            <div className="pt-4 border-t border-slate-100">
                {isReturn ? (
                    <div className="space-y-4">

                        {/* ── Returnable Items Picker ── */}
                        {!editMode && (
                            <div className="border border-emerald-200 rounded-xl bg-emerald-50/40">
                                <button
                                    type="button"
                                    onClick={() => setPickerOpen(v => !v)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100/50 transition-colors rounded-t-xl"
                                >
                                    <div className="flex items-center gap-2">
                                        <RotateCcw className="w-4 h-4 shrink-0" />
                                        <span>Your returnable items</span>
                                        {!loadingReturnableItems && returnableItems.length > 0 && (
                                            <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1 rounded-full bg-emerald-600 text-white text-xs font-bold">
                                                {returnableItems.length}
                                            </span>
                                        )}
                                    </div>
                                    {pickerOpen
                                        ? <ChevronUp className="w-4 h-4 text-emerald-600 shrink-0" />
                                        : <ChevronDown className="w-4 h-4 text-emerald-600 shrink-0" />
                                    }
                                </button>

                                <AnimatePresence initial={false}>
                                    {pickerOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden rounded-b-xl"
                                        >
                                            <div className="border-t border-emerald-200">
                                                {loadingReturnableItems ? (
                                                    <div className="flex items-center justify-center gap-2 py-6 text-slate-500 text-sm">
                                                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                                                        Loading your materials…
                                                    </div>
                                                ) : returnableItems.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                                                        <Package className="w-10 h-10 text-slate-300" />
                                                        <p className="text-sm font-medium text-slate-600">No materials available to return</p>
                                                        <p className="text-xs text-slate-400">You have no approved take transactions with unreturned items.</p>
                                                    </div>
                                                ) : (
                                                    <div
                                                        className="akk-scroll-y divide-y divide-emerald-100 max-h-60 overscroll-contain touch-pan-y"
                                                        onWheel={(e) => e.stopPropagation()}
                                                    >
                                                        {returnableItems.map((item) => {
                                                            const isSelected = selectedRefNumbers.has(item.reference_number);
                                                            return (
                                                                <button
                                                                    key={item.reference_number}
                                                                    type="button"
                                                                    onClick={() => selectReturnableItem(item)}
                                                                    disabled={isSelected}
                                                                    className={`w-full block px-4 py-3 text-left transition-colors
                                                                        ${isSelected
                                                                            ? 'bg-emerald-100/60 cursor-default'
                                                                            : 'bg-emerald-50/40 hover:bg-white/80 active:bg-emerald-100 cursor-pointer'
                                                                        }`}
                                                                >
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <span className="font-mono text-xs font-semibold bg-white border border-slate-200 px-2 py-1 rounded text-slate-700 shrink-0">
                                                                            #{item.reference_number}
                                                                        </span>
                                                                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                                                            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
                                                                                {item.available_quantity} {item.unit}
                                                                            </span>
                                                                            {isSelected ? (
                                                                                <CheckCircle className="w-4 h-4 text-emerald-600" />
                                                                            ) : (
                                                                                <PlusCircle className="w-4 h-4 text-emerald-500" />
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <p className="mt-1.5 text-sm font-medium text-slate-800 leading-snug break-words">
                                                                        {item.name}
                                                                    </p>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <div className="px-4 py-2 border-t border-emerald-100 bg-emerald-50/30">
                                                    <p className="text-xs text-slate-500">
                                                        Tap an item to add it below. You can also enter a reference number manually.
                                                    </p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        {/* ── Selected / manual reference rows ── */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700">
                                    Items to Return
                                    {materials.some(m => m.name) && (
                                        <span className="ml-2 text-xs font-normal text-slate-500">
                                            ({materials.filter(m => m.name).length} selected)
                                        </span>
                                    )}
                                </label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={addReferenceNumberInput}
                                    className="text-[#1e3a5f] border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5 text-xs"
                                >
                                    <PlusCircle className="w-3.5 h-3.5 mr-1" />
                                    Add manually
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {materials.map((material, index) => (
                                    <div
                                        key={`${index}-${material.reference_number}`}
                                        className="space-y-3 p-4 border border-slate-200 rounded-xl bg-slate-50/50"
                                    >
                                        {/* Reference number row */}
                                        <div className="flex gap-2 items-start">
                                            <div className="flex-1 space-y-1.5">
                                                <label className="text-xs font-medium text-slate-600">
                                                    Reference Number
                                                </label>
                                                <div className="relative">
                                                    <Input
                                                        placeholder="e.g. 482739 — or pick from list above"
                                                        value={material.reference_number || ''}
                                                        onChange={(e) => handleReferenceNumberChange(index, e.target.value)}
                                                        className={`border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20 font-mono pr-8
                                                            ${material.error ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20' : ''}
                                                            ${material.name && !material.error ? 'border-emerald-300' : ''}
                                                        `}
                                                    />
                                                    {material.loading && (
                                                        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
                                                    )}
                                                    {material.name && !material.loading && !material.error && (
                                                        <CheckCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                                                    )}
                                                </div>
                                                {material.error && (
                                                    <p className="text-xs text-red-500 flex items-center gap-1">
                                                        <X className="w-3 h-3" />
                                                        {material.error}
                                                    </p>
                                                )}
                                            </div>

                                            {materials.length > 1 && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => removeReferenceNumberInput(index)}
                                                    className="mt-6 h-11 w-11 shrink-0 text-red-400 hover:bg-red-50 hover:text-red-600"
                                                    title="Remove this item"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>

                                        {/* Material details (auto-filled after lookup) */}
                                        {material.name && !material.error && (
                                            <>
                                                <div className="grid grid-cols-1 gap-3 max-sm:min-w-0 sm:grid-cols-2">
                                                    <div className="min-w-0 space-y-1">
                                                        <label className="text-xs font-medium text-slate-600">Material</label>
                                                        <div className="text-sm text-slate-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg font-medium">
                                                            {material.name}
                                                        </div>
                                                    </div>
                                                    <div className="min-w-0 space-y-1">
                                                        <label className="text-xs font-medium text-slate-600">Available to Return</label>
                                                        <div className="text-sm text-slate-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
                                                            {material.available_quantity ?? material.quantity} {material.unit}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <label className="text-sm font-medium text-slate-700">
                                                        Return Quantity <span className="text-red-500">*</span>
                                                    </label>
                                                    <div className="flex min-w-0 flex-col gap-2 max-sm:items-stretch sm:flex-row sm:items-center">
                                                        <Input
                                                            type="number"
                                                            placeholder={`Max ${material.available_quantity ?? material.quantity}`}
                                                            value={material.return_quantity ?? ''}
                                                            onChange={(e) => {
                                                                const updated = [...materials];
                                                                const parsed = parseReturnQty(e.target.value);
                                                                updated[index] = {
                                                                    ...updated[index],
                                                                    return_quantity: e.target.value === '' ? '' : parsed,
                                                                };
                                                                setMaterials(updated);
                                                            }}
                                                            onBlur={(e) => {
                                                                const inputValue = e.target.value.trim();
                                                                let finalValue;

                                                                if (inputValue === '') {
                                                                    finalValue = undefined;
                                                                } else {
                                                                    const parsed = parseReturnQty(inputValue);
                                                                    if (parsed < 1) {
                                                                        finalValue = undefined;
                                                                        toast.error('Please enter a valid quantity of at least 1');
                                                                    } else {
                                                                        const maxQty = material.available_quantity ?? material.quantity;
                                                                        if (parsed > maxQty) {
                                                                            finalValue = undefined;
                                                                            toast.error(`Cannot return more than ${maxQty} ${material.unit}`);
                                                                            const updated = [...materials];
                                                                            updated[index] = { ...updated[index], return_quantity: '' };
                                                                            setMaterials(updated);
                                                                            return;
                                                                        } else {
                                                                            finalValue = parsed;
                                                                        }
                                                                    }
                                                                }

                                                                const updated = [...materials];
                                                                updated[index] = { ...updated[index], return_quantity: finalValue };
                                                                setMaterials(updated);
                                                            }}
                                                            className="min-w-0 flex-1 border-slate-200 focus:border-emerald-500 focus:ring-emerald-500/20"
                                                            min="1"
                                                            step="1"
                                                        />
                                                        <span className="shrink-0 text-sm text-slate-500">{material.unit}</span>
                                                    </div>
                                                    <p className="text-xs text-slate-400">
                                                        Partial returns are allowed (whole units)
                                                    </p>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <MaterialInput
                        materials={materials}
                        setMaterials={setMaterials}
                        editMode={editMode}
                        excludeTransactionId={editMode ? existingTransaction?.id : null}
                    />
                )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                <Textarea
                    placeholder="Any additional notes…"
                    value={formData.notes}
                    onChange={(e) => handleInputChange('notes', e.target.value)}
                    className="border-slate-200 focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20 min-h-[80px]"
                />
            </div>

            {/* Submit / Delete */}
            <div className="akk-form-actions flex gap-3">
                {editMode && onDelete && (
                    <Button
                        type="button"
                        onClick={onDelete}
                        variant="destructive"
                        className="flex-1 py-6 text-lg font-medium bg-red-600 hover:bg-red-700"
                    >
                        Delete Request
                    </Button>
                )}
                <Button
                    type="submit"
                    disabled={isSubmitting || loadingSites || sites.length === 0 || !formData.site_id}
                    className={`${editMode && onDelete ? 'flex-1' : 'w-full'} py-6 text-lg font-medium ${
                        isReturn
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-brand hover:bg-brand-hover'
                    }`}
                >
                    {isSubmitting ? (
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                        <Send className="w-5 h-5 mr-2" />
                    )}
                    {isSubmitting
                        ? (editMode ? 'Updating…' : 'Submitting…')
                        : (editMode ? 'Update Request' : `Submit ${isReturn ? 'Return' : 'Take'} Record`)
                    }
                </Button>
            </div>
        </form>
    );

    // App: the title lives in the navigation bar, so the form is a single card
    // with a sticky glass submit bar. The website keeps its coloured header card.
    if (native) {
        return (
            <div className="n-form w-full">
                <Card className="overflow-visible">
                    <CardContent className="p-6">{formBody}</CardContent>
                </Card>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full max-w-2xl mx-auto"
        >
            {/* overflow-visible so catalog autocomplete / pickers are not clipped */}
            <Card className="overflow-visible">
                <CardHeader className={`${isReturn ? 'bg-emerald-600' : 'bg-brand'} text-white rounded-t-xl`}>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onBack}
                            className="text-white hover:bg-white/20"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="flex items-center gap-3">
                            {isReturn ? <RotateCcw className="w-6 h-6" /> : <Package className="w-6 h-6" />}
                            <CardTitle className="text-xl font-semibold">
                                {editMode ? `Edit ${isReturn ? 'Return' : 'Take'} Request` : isReturn ? 'Return Materials' : 'Take Materials'}
                            </CardTitle>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-6">
                    {formBody}
                </CardContent>
            </Card>
        </motion.div>
    );
}
