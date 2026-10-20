import React, { useState, useEffect } from 'react';
import { supabaseMaterials } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Pencil, Trash2, Plus, X, Check, Search, Users, Eye, EyeOff, Printer } from 'lucide-react';
import { formatDisplayDateTime, formatFileDate } from '@/modules/materials/lib/dates';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { escapeHtml } from '@/modules/materials/lib/utils';
import { openPrintDocument, printFailureMessage } from '@/modules/materials/lib/printDocument';

const sortByRequesterId = (a, b) =>
    (a.requester_id ?? '').localeCompare(b.requester_id ?? '', undefined, {
        numeric: true,
        sensitivity: 'base',
    });

export default function RequestersManager() {
    const [requesters, setRequesters] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ requester_id: '', name: '', password: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [visiblePasswords, setVisiblePasswords] = useState({});

    const fetchRequesters = async () => {
        try {
            const { data, error } = await supabaseMaterials
                .from('requesters')
                .select('*');
            
            if (error) throw error;
            setRequesters((data || []).sort(sortByRequesterId));
        } catch (error) {
            console.error('Error fetching requesters:', error);
            toast.error('Failed to load requesters');
        }
    };

    useEffect(() => {
        fetchRequesters();
    }, []);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.requester_id || !formData.name || (!editingId && !formData.password)) {
            toast.error('All fields are required');
            return;
        }

        setIsLoading(true);
        try {
            const requesterData = {
                requester_id: formData.requester_id,
                name: formData.name,
            };

            // If password is provided, update it (only for new or when changing password)
            if (formData.password) {
                // Hashing should be server-side. Browser-side bcrypt is not a substitute.
                requesterData.password_hash = formData.password;
            }

            if (editingId) {
                const { error } = await supabaseMaterials
                    .from('requesters')
                    .update(requesterData)
                    .eq('id', editingId);
                
                if (error) throw error;
                toast.success('Requester updated successfully');
            } else {
                const { error } = await supabaseMaterials
                    .from('requesters')
                    .insert([requesterData]);
                
                if (error) throw error;
                toast.success('Requester added successfully');
            }

            setFormData({ requester_id: '', name: '', password: '' });
            setEditingId(null);
            fetchRequesters();
        } catch (error) {
            console.error('Error saving requester:', error);
            toast.error(error.message || 'Failed to save requester');
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (requester) => {
        setEditingId(requester.id);
        setFormData({
            requester_id: requester.requester_id,
            name: requester.name,
            password: '' // Don't show existing password
        });
    };

    const handleDelete = async (id) => {
        if (!(await confirmAction({
            title: 'Delete requester?',
            message: 'Are you sure you want to delete this requester? This action cannot be undone.',
            confirmLabel: 'Delete',
            destructive: true,
        }))) {
            return;
        }

        try {
            const { error } = await supabaseMaterials
                .from('requesters')
                .delete()
                .eq('id', id);
            
            if (error) throw error;
            
            toast.success('Requester deleted successfully');
            fetchRequesters();
        } catch (error) {
            console.error('Error deleting requester:', error);
            toast.error('Failed to delete requester');
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setFormData({ requester_id: '', name: '', password: '' });
    };

    const filteredRequesters = requesters
        .filter(r => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return (
                r.requester_id?.toLowerCase().includes(term) ||
                r.name?.toLowerCase().includes(term)
            );
        })
        .sort(sortByRequesterId);

    const printRequestersList = () => {
        const listToPrint = [...requesters].sort(sortByRequesterId);
        if (listToPrint.length === 0) {
            toast.error('No requesters to print');
            return;
        }

        const printedAt = formatDisplayDateTime(new Date());
        const rows = listToPrint.map((r, i) => `
            <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
                <td class="mono">${escapeHtml(r.requester_id ?? '')}</td>
                <td>${escapeHtml(r.name ?? '')}</td>
                <td class="date">${r.created_at ? formatDisplayDateTime(r.created_at) : '—'}</td>
            </tr>
        `).join('');

        try {
            openPrintDocument(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>AKK Requesters List</title>
                <style>
                    * { box-sizing: border-box; }
                    body {
                        font-family: 'Segoe UI', Calibri, sans-serif;
                        margin: 0;
                        padding: 24px;
                        color: #1e293b;
                        background: #fff;
                    }
                    .header {
                        text-align: center;
                        border-bottom: 3px solid #dc6b2f;
                        padding-bottom: 16px;
                        margin-bottom: 20px;
                    }
                    .company { font-size: 22px; font-weight: 700; color: #dc6b2f; margin: 0; }
                    .subtitle { font-size: 16px; font-weight: 600; margin: 8px 0 0; color: #334155; }
                    .meta { font-size: 12px; color: #64748b; margin-top: 6px; }
                    .confidential {
                        background: #fef3c7;
                        border: 1px solid #f59e0b;
                        color: #92400e;
                        padding: 10px 14px;
                        border-radius: 8px;
                        font-size: 12px;
                        margin-bottom: 20px;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 13px;
                    }
                    th {
                        background: #334155;
                        color: #fff;
                        text-align: left;
                        padding: 10px 12px;
                        font-weight: 600;
                    }
                    td {
                        padding: 9px 12px;
                        border-bottom: 1px solid #e2e8f0;
                        vertical-align: middle;
                    }
                    tr.even td { background: #f8fafc; }
                    tr.odd td { background: #fff; }
                    .mono { font-family: Consolas, 'Courier New', monospace; }
                    .date { color: #64748b; font-size: 12px; white-space: nowrap; }
                    .footer {
                        margin-top: 24px;
                        padding-top: 12px;
                        border-top: 1px solid #e2e8f0;
                        font-size: 11px;
                        color: #94a3b8;
                        text-align: center;
                    }
                    @media print {
                        body { padding: 12px; }
                        .confidential { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <p class="company">AKK Engineering Pte. Ltd.</p>
                    <p class="subtitle">Worker Requesters</p>
                    <p class="meta">Printed ${printedAt} · ${listToPrint.length} requester(s)</p>
                </div>
                <div class="confidential">
                    <strong>Confidential</strong> — This document lists requester IDs. Do not share publicly.
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:22%">Requester ID</th>
                            <th style="width:48%">Name</th>
                            <th style="width:30%">Created</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
                <p class="footer">AKK Material Tracker · Admin generated report</p>
            </body>
            </html>
        `, {
                id: 'ALL',
                date: formatFileDate(new Date()),
                formName: 'Requesters List',
            });
        } catch (error) {
            toast.error(printFailureMessage(error));
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">
                        {editingId ? 'Edit Requester' : 'Add New Requester'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="text-sm font-medium leading-none mb-1 block">
                                    Requester ID
                                </label>
                                <Input
                                    name="requester_id"
                                    value={formData.requester_id}
                                    onChange={handleInputChange}
                                    placeholder="Enter requester ID"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium leading-none mb-1 block">
                                    Name
                                </label>
                                <Input
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    placeholder="Enter full name"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium leading-none mb-1 block">
                                    {editingId ? 'New Password (leave blank to keep current)' : 'Password'}
                                </label>
                                <Input
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    placeholder={editingId ? 'Enter new password' : 'Enter password'}
                                    required={!editingId}
                                />
                            </div>
                        </div>
                        <div className="flex space-x-2 pt-2">
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? (
                                    <span className="flex items-center">
                                        <span className="animate-spin mr-2">↻</span>
                                        {editingId ? 'Updating...' : 'Adding...'}
                                    </span>
                                ) : editingId ? (
                                    <>
                                        <Check className="w-4 h-4 mr-2" />
                                        Update Requester
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-4 h-4 mr-2" />
                                        Add Requester
                                    </>
                                )}
                            </Button>
                            {editingId && (
                                <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading}>
                                    <X className="w-4 h-4 mr-2" />
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <Users className="w-5 h-5 text-slate-500" />
                            <CardTitle className="text-xl">Requesters List</CardTitle>
                            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-medium text-slate-600">
                                {filteredRequesters.length}{searchTerm ? ` / ${requesters.length}` : ''}
                            </span>
                        </div>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={printRequestersList}
                                disabled={requesters.length === 0}
                                className="shrink-0 border-slate-300"
                            >
                                <Printer className="w-4 h-4 mr-2" />
                                Print List
                            </Button>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    className="pl-9"
                                    placeholder="Search by ID or name..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {requesters.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No requesters found. Add one using the form above.
                        </div>
                    ) : filteredRequesters.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No requesters match your search.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>ID</TableHead>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Password</TableHead>
                                        <TableHead>Created At</TableHead>
                                        <TableHead className="w-32">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredRequesters.map((requester) => (
                                        <TableRow key={requester.id} className={editingId === requester.id ? 'bg-blue-50' : ''}>
                                            <TableCell className="font-medium">{requester.requester_id}</TableCell>
                                            <TableCell>{requester.name}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-sm">
                                                        {visiblePasswords[requester.id]
                                                            ? requester.password_hash
                                                            : '••••••••'}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setVisiblePasswords(prev => ({
                                                                ...prev,
                                                                [requester.id]: !prev[requester.id],
                                                            }))
                                                        }
                                                        className="text-slate-400 hover:text-slate-600"
                                                        title={visiblePasswords[requester.id] ? 'Hide password' : 'Show password'}
                                                    >
                                                        {visiblePasswords[requester.id]
                                                            ? <EyeOff className="h-4 w-4" />
                                                            : <Eye className="h-4 w-4" />}
                                                    </button>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-slate-500 text-sm">
                                                {requester.created_at ? formatDisplayDateTime(requester.created_at) : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleEdit(requester)}
                                                        title="Edit requester"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => handleDelete(requester.id)}
                                                        title="Delete requester"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
