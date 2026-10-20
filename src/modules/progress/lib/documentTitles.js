import { supabaseProgress } from '@/core/supabase'
import { portalExporterToken, portalManagerToken } from '@/core/auth/progress/portalAuth';

export async function listDocumentTitles({ asExporter = false } = {}) {
  if (asExporter) {
    const { data, error } = await supabaseProgress.rpc('exporter_list_document_titles', {
      p_exporter_token: portalExporterToken(),
    });
    if (error) throw error;
    return (data || []).map((r) => r.title);
  }
  const { data, error } = await supabaseProgress.rpc('staff_list_document_titles', {
    p_manager_token: portalManagerToken(),
  });
  if (error) throw error;
  return (data || []).map((r) => r.title);
}

export async function recordDocumentTitleUse(title, { asExporter = false } = {}) {
  if (asExporter) {
    const { error } = await supabaseProgress.rpc('exporter_use_document_title', {
      p_exporter_token: portalExporterToken(),
      p_title: title,
    });
    if (error) throw error;
    return;
  }
  const { error } = await supabaseProgress.rpc('staff_use_document_title', {
    p_title: title,
    p_manager_token: portalManagerToken(),
  });
  if (error) throw error;
}
