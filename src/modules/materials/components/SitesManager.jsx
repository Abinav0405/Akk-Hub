import React, { useState, useEffect } from 'react';
import { supabaseMaterials } from '@/core/supabase'
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table';
import { Pencil, Trash2, Plus, X, Check, Search, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { confirmAction } from '@/modules/materials/components/mobile/NativeConfirm';
import { formatDisplayDateTime } from '@/modules/materials/lib/dates';

export default function SitesManager() {
    const [sites, setSites] = useState([]);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ name: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchSites = async () => {
        try {
            const { data, error } = await supabaseMaterials
                .from('sites')
                .select('*')
                .order('name', { ascending: true });
            if (error) throw error;
            setSites(data || []);
        } catch (error) {
            console.error('Error fetching sites:', error);
            toast.error('Failed to load sites');
        }
    };

    useEffect(() => {
        fetchSites();
    }, []);

    const handleInputChange = (e) => {
        setFormData({ name: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedName = formData.name.trim();
        if (!trimmedName) {
            toast.error('Site name is required');
            return;
        }

        setIsLoading(true);
        try {
            if (editingId) {
                const { error } = await supabaseMaterials
                    .from('sites')
                    .update({ name: trimmedName })
                    .eq('id', editingId);
                if (error) throw error;
                toast.success('Site updated successfully');
            } else {
                const { error } = await supabaseMaterials
                    .from('sites')
                    .insert([{ name: trimmedName }]);
                if (error) throw error;
                toast.success('Site added successfully');
            }
            setFormData({ name: '' });
            setEditingId(null);
            fetchSites();
        } catch (error) {
            console.error('Error saving site:', error);
            if (error.code === '23505') {
                toast.error('A site with this name already exists');
            } else {
                toast.error(error.message || 'Failed to save site');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (site) => {
        setEditingId(site.id);
        setFormData({ name: site.name });
    };

    const handleDelete = async (id) => {
        // Check if site is used in any transactions
        try {
            const { data: usages, error: checkError } = await supabaseMaterials
                .from('transactions')
                .select('id')
                .eq('site_id', id)
                .limit(1);

            if (checkError) throw checkError;

            const inUse = usages && usages.length > 0;
            const confirmMsg = inUse
                ? 'This site is used in existing transactions. Deleting it will clear site_id on those records, but the site_name snapshot on old transactions will remain. Are you sure?'
                : 'Are you sure you want to delete this site? This action cannot be undone.';

            if (!(await confirmAction({
                title: 'Delete site?',
                message: confirmMsg,
                confirmLabel: 'Delete',
                destructive: true,
            }))) return;

            const { error } = await supabaseMaterials
                .from('sites')
                .delete()
                .eq('id', id);

            if (error) throw error;
            toast.success('Site deleted successfully');
            fetchSites();
        } catch (error) {
            console.error('Error deleting site:', error);
            toast.error('Failed to delete site');
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setFormData({ name: '' });
    };

    const filteredSites = sites.filter(s => {
        if (!searchTerm) return true;
        return s.name?.toLowerCase().includes(searchTerm.toLowerCase());
    });

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">
                        {editingId ? 'Edit Site' : 'Add New Site'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="max-w-sm">
                            <label className="text-sm font-medium leading-none mb-1 block">
                                Site Name
                            </label>
                            <Input
                                name="name"
                                value={formData.name}
                                onChange={handleInputChange}
                                placeholder="Enter site name"
                                required
                            />
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
                                        Update Site
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-4 h-4 mr-2" />
                                        Add Site
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
                            <MapPin className="w-5 h-5 text-slate-500" />
                            <CardTitle className="text-xl">Sites List</CardTitle>
                            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-medium text-slate-600">
                                {filteredSites.length}{searchTerm ? ` / ${sites.length}` : ''}
                            </span>
                        </div>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                className="pl-9"
                                placeholder="Search sites..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {sites.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No sites found. Add one using the form above.
                        </div>
                    ) : filteredSites.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            No sites match your search.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Site Name</TableHead>
                                        <TableHead>Created At</TableHead>
                                        <TableHead className="w-32">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredSites.map((site) => (
                                        <TableRow key={site.id} className={editingId === site.id ? 'bg-blue-50' : ''}>
                                            <TableCell className="font-medium">{site.name}</TableCell>
                                            <TableCell className="text-slate-500 text-sm">
                                                {site.created_at ? formatDisplayDateTime(site.created_at) : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => handleEdit(site)}
                                                        title="Edit site"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => handleDelete(site.id)}
                                                        title="Delete site"
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
