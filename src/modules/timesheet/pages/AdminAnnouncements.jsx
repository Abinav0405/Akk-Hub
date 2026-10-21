import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { ImagePlus, PlusCircle, Trash2, ToggleLeft, ToggleRight, X, Megaphone } from 'lucide-react';
import { cn } from '@/modules/timesheet/lib/utils';
import { AdminPageShell } from '@/ui/PortalShell';
import { glassInput, glassPanel } from '@/ui/glass';
import {
    ANNOUNCEMENT_IMAGE_ACCEPT,
    removeAnnouncementImageFromStorage,
    uploadAnnouncementImage,
    validateAnnouncementImage,
} from '@/modules/timesheet/lib/announcementImages';
import { toast } from 'sonner';

function AnnouncementImage({ src, alt, className = '' }) {
    if (!src) return null;
    return (
        <img
            src={src}
            alt={alt}
            className={`max-h-48 w-full rounded-lg border border-slate-200 object-contain bg-slate-50 ${className}`}
            loading="lazy"
        />
    );
}

export default function AdminAnnouncements() {
    const queryClient = useQueryClient();
    const createFileInputRef = useRef(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);

    useEffect(() => {
        if (!imageFile) {
            setImagePreview(null);
            return undefined;
        }
        const url = URL.createObjectURL(imageFile);
        setImagePreview(url);
        return () => URL.revokeObjectURL(url);
    }, [imageFile]);

    const clearCreateImage = () => {
        setImageFile(null);
        if (createFileInputRef.current) createFileInputRef.current.value = '';
    };

    const handleCreateImageChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const err = validateAnnouncementImage(file);
        if (err) {
            toast.error(err);
            e.target.value = '';
            return;
        }
        setImageFile(file);
    };

    const announcementsQuery = useQuery({
        queryKey: ['admin-announcements'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .order('publish_at', { ascending: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        },
    });

    const createAnnouncement = useMutation({
        mutationFn: async () => {
            const t = title.trim();
            const b = body.trim();
            if (!t || !b) throw new Error('Title and message are required.');

            const { data: inserted, error } = await supabase
                .from('announcements')
                .insert([
                    {
                        title: t,
                        body: b,
                        audience: 'workers',
                        is_active: true,
                    },
                ])
                .select('id')
                .single();

            if (error) throw error;

            if (imageFile && inserted?.id) {
                const imageUrl = await uploadAnnouncementImage(inserted.id, imageFile);
                const { error: updateError } = await supabase
                    .from('announcements')
                    .update({ image_url: imageUrl })
                    .eq('id', inserted.id);
                if (updateError) throw updateError;
            }
        },
        onSuccess: async () => {
            setTitle('');
            setBody('');
            clearCreateImage();
            toast.success('Announcement posted');
            await queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to post announcement'),
    });

    const toggleActive = useMutation({
        mutationFn: async ({ id, next }) => {
            const { error } = await supabase.from('announcements').update({ is_active: next }).eq('id', id);
            if (error) throw error;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to update'),
    });

    const updateAnnouncementImage = useMutation({
        mutationFn: async ({ id, file, previousUrl }) => {
            const imageUrl = await uploadAnnouncementImage(id, file);
            const { error } = await supabase.from('announcements').update({ image_url: imageUrl }).eq('id', id);
            if (error) throw error;
            if (previousUrl && previousUrl !== imageUrl) {
                try {
                    await removeAnnouncementImageFromStorage(previousUrl);
                } catch {
                    /* keep new image even if old file cleanup fails */
                }
            }
        },
        onSuccess: async () => {
            toast.success('Image updated');
            await queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to update image'),
    });

    const removeAnnouncementImage = useMutation({
        mutationFn: async ({ id, imageUrl }) => {
            const { error } = await supabase.from('announcements').update({ image_url: null }).eq('id', id);
            if (error) throw error;
            if (imageUrl) {
                try {
                    await removeAnnouncementImageFromStorage(imageUrl);
                } catch {
                    /* row cleared; storage cleanup is best-effort */
                }
            }
        },
        onSuccess: async () => {
            toast.success('Image removed');
            await queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to remove image'),
    });

    const deleteAnnouncement = useMutation({
        mutationFn: async (row) => {
            if (row.image_url) {
                try {
                    await removeAnnouncementImageFromStorage(row.image_url);
                } catch {
                    /* proceed with row delete */
                }
            }
            const { error } = await supabase.from('announcements').delete().eq('id', row.id);
            if (error) throw error;
        },
        onSuccess: async () => {
            toast.success('Deleted');
            await queryClient.invalidateQueries({ queryKey: ['admin-announcements'] });
        },
        onError: (e) => toast.error(e.message || 'Failed to delete'),
    });

    const list = announcementsQuery.data || [];
    const activeCount = useMemo(() => list.filter((a) => a.is_active).length, [list]);
    const imageBusy =
        createAnnouncement.isPending ||
        updateAnnouncementImage.isPending ||
        removeAnnouncementImage.isPending;

    const handleReplaceImage = (announcement, e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const err = validateAnnouncementImage(file);
        if (err) {
            toast.error(err);
            return;
        }
        updateAnnouncementImage.mutate({
            id: announcement.id,
            file,
            previousUrl: announcement.image_url,
        });
    };

    return (
        <AdminPageShell
            title="Announcements"
            subtitle={`${activeCount} active`}
            icon={Megaphone}
            tone="indigo"
            maxWidth="max-w-5xl"
        >
                <div className={cn(glassPanel, 'space-y-3 p-5')}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Post a new announcement</h2>
                            <Button
                                onClick={() => createAnnouncement.mutate()}
                                disabled={createAnnouncement.isPending || imageBusy}
                                className="min-h-11 rounded-xl bg-[var(--g-brand)] hover:bg-[var(--g-brand-press)]"
                            >
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Post
                            </Button>
                        </div>
                        <Input className={glassInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
                        <Textarea className="rounded-xl border-slate-200" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" rows={4} />
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    ref={createFileInputRef}
                                    type="file"
                                    accept={ANNOUNCEMENT_IMAGE_ACCEPT}
                                    className="hidden"
                                    onChange={handleCreateImageChange}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => createFileInputRef.current?.click()}
                                    disabled={imageBusy}
                                >
                                    <ImagePlus className="mr-2 h-4 w-4" />
                                    {imageFile ? 'Change image' : 'Attach image (optional)'}
                                </Button>
                                {imageFile ? (
                                    <Button type="button" variant="ghost" size="sm" onClick={clearCreateImage} disabled={imageBusy}>
                                        <X className="mr-1 h-4 w-4" />
                                        Remove
                                    </Button>
                                ) : null}
                            </div>
                            {imagePreview ? (
                                <AnnouncementImage src={imagePreview} alt="Preview of attached announcement image" />
                            ) : null}
                            <p className="text-xs text-slate-500">JPEG, PNG, WebP, or GIF up to 5 MB. Image is optional.</p>
                        </div>
                </div>

                <div className={cn(glassPanel, 'p-5')}>
                        <h2 className="text-lg font-semibold tracking-tight text-slate-900">All announcements</h2>
                        <div className="mt-4 space-y-3">
                            {list.length === 0 ? (
                                <p className="text-sm text-slate-600">No announcements yet.</p>
                            ) : (
                                list.map((a) => (
                                    <div key={a.id} className="rounded-[var(--g-r-lg)] border border-[var(--g-hairline)] bg-[var(--g-surface)] p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1 space-y-2">
                                                <p className="truncate font-semibold text-slate-900">{a.title}</p>
                                                <p className="text-sm text-slate-600 whitespace-pre-wrap">{a.body}</p>
                                                {a.image_url ? (
                                                    <AnnouncementImage src={a.image_url} alt={`Image for ${a.title}`} />
                                                ) : null}
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <input
                                                        type="file"
                                                        accept={ANNOUNCEMENT_IMAGE_ACCEPT}
                                                        className="hidden"
                                                        id={`announcement-image-${a.id}`}
                                                        onChange={(e) => handleReplaceImage(a, e)}
                                                        disabled={imageBusy}
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={imageBusy}
                                                        onClick={() => document.getElementById(`announcement-image-${a.id}`)?.click()}
                                                    >
                                                        <ImagePlus className="mr-2 h-4 w-4" />
                                                        {a.image_url ? 'Replace image' : 'Add image'}
                                                    </Button>
                                                    {a.image_url ? (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={imageBusy}
                                                            onClick={() =>
                                                                removeAnnouncementImage.mutate({
                                                                    id: a.id,
                                                                    imageUrl: a.image_url,
                                                                })
                                                            }
                                                        >
                                                            Remove image
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    className={
                                                        a.is_active
                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                                    }
                                                    onClick={() => toggleActive.mutate({ id: a.id, next: !a.is_active })}
                                                >
                                                    {a.is_active ? (
                                                        <>
                                                            <ToggleRight className="mr-2 h-4 w-4" /> Active
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ToggleLeft className="mr-2 h-4 w-4" /> Inactive
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    onClick={() => deleteAnnouncement.mutate(a)}
                                                    disabled={deleteAnnouncement.isPending}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                </div>
        </AdminPageShell>
    );
}