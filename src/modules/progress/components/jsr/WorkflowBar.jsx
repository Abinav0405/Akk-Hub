import { Button } from '@/ui/button';
import { CLIENT_VISIBLE_STATUSES, clientCanRespond } from '@/modules/progress/lib/jsrStatus';
import { jsrCan } from '@/modules/progress/lib/jsrPermissions';
import { jsrHasExporters } from '@/modules/progress/lib/jsr';
import { runWorkflow } from '@/modules/progress/components/jsr/shared';

export default function WorkflowBar({
  kind,
  record,
  role,
  perms = {},
  onRefresh,
  onEdit,
  onDelete,
  onPrepareInvoice,
  onClientReview,
  onPassToClient,
  onAssignExporter,
  onSubmitInvoice,
  onAddToClaim,
}) {
  const st = record?.status;
  const allow = (key) => jsrCan(role, perms, key);
  const primary = [];
  const secondary = [];
  const btn = (node, quiet) => (quiet ? secondary : primary).push(node);

  if (st === 'draft' && allow(kind === 'jsr' ? 'submit_jsr' : 'submit_claim')) {
    btn((
      <Button key="submit" size="sm" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'submit', {}, onRefresh)}>
        Submit for approval
      </Button>
    ));
  }
  if (st === 'submitted' && allow(kind === 'jsr' ? 'approve_jsr' : 'approve_claim')) {
    btn((
      <Button key="app" size="sm" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'approve', {}, onRefresh)}>
        Mark reviewed
      </Button>
    ));
    btn((
      <Button key="rej" size="sm" variant="destructive" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'reject', {}, onRefresh)}>
        Reject
      </Button>
    ), true);
  }
  if (st === 'approved') {
    if (kind === 'jsr' && onPassToClient && allow('pass_out_jsr')) {
      btn((
        <Button key="pass" size="sm" className="w-full sm:w-auto" onClick={onPassToClient}>
          Pass to client
        </Button>
      ));
    } else if (kind !== 'jsr' && allow('pass_out_claim') && onPassToClient) {
      btn((
        <Button key="pass" size="sm" className="w-full sm:w-auto" onClick={onPassToClient}>
          Pass to client
        </Button>
      ));
    }
  }
  if (onAssignExporter && CLIENT_VISIBLE_STATUSES.includes(st) && allow('assign_exporter')) {
    btn((
      <Button key="assign" size="sm" variant="outline" className="w-full sm:w-auto" onClick={onAssignExporter}>
        {jsrHasExporters(record) ? 'Change Export Only' : 'Assign Export Only'}
      </Button>
    ), true);
  }
  // A JSR the client accepted goes onto a monthly claim; the payment certificate is the claim's.
  const clientAccepted = ['c-approved', 'c-certified', 'c-partial'].includes(st);
  if (kind === 'jsr' && clientAccepted && onAddToClaim && !record?.claim_id && (allow('create_claim') || allow('edit_claim'))) {
    btn((
      <Button key="claim" size="sm" className="w-full sm:w-auto" onClick={onAddToClaim}>
        Add to claim
      </Button>
    ));
  }
  if (kind !== 'jsr' && clientAccepted && allow('payment_cert')) {
    btn((
      <Button key="cert" size="sm" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'payment_cert', {}, onRefresh)}>
        Payment cert received
      </Button>
    ));
  }
  if (st === 'paymentcert' && allow('prepare_invoice')) {
    btn((
      <Button key="prep" size="sm" className="w-full sm:w-auto" onClick={onPrepareInvoice}>
        Prepare invoice
      </Button>
    ));
  }
  if (st === 'invoiceprepared' && allow('submit_invoice')) {
    btn((
      <Button
        key="subi"
        size="sm"
        className="w-full sm:w-auto"
        onClick={onSubmitInvoice || (() => runWorkflow(kind, record.id, 'submit_invoice', {}, onRefresh))}
      >
        Submit invoice to client
      </Button>
    ));
  }
  if (st === 'invoicesubmitted' && allow('mark_payment')) {
    btn((
      <Button key="pend" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'payment_pending', {}, onRefresh)}>
        Mark payment pending
      </Button>
    ), true);
  }
  if (st === 'paymentpending' && allow('mark_payment')) {
    btn((
      <Button key="paid" size="sm" className="w-full sm:w-auto" onClick={() => runWorkflow(kind, record.id, 'paid', {}, onRefresh)}>
        Mark paid
      </Button>
    ));
  }
  const canEditRecord = kind === 'jsr'
    ? (st === 'draft' || st === 'rejected' || st === 'submitted') && allow('edit_jsr')
    : (st === 'draft' || st === 'rejected') && allow('edit_claim');
  if (canEditRecord && onEdit) {
    btn((
      <Button key="edit" size="sm" variant="outline" className="w-full sm:w-auto" onClick={onEdit}>
        Edit
      </Button>
    ), true);
  }
  if (role === 'exporter' && clientCanRespond(st) && onClientReview) {
    btn((
      <Button key="rv" size="sm" className="w-full sm:w-auto" onClick={onClientReview}>
        Review / respond
      </Button>
    ));
  }
  if (onDelete && allow(kind === 'jsr' ? 'delete_jsr' : 'delete_claim')) {
    btn((
      <Button key="del" size="sm" variant="destructive" className="w-full sm:w-auto" onClick={onDelete}>
        Delete
      </Button>
    ), true);
  }

  if (!primary.length && !secondary.length) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      {primary.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{primary}</div> : null}
      {secondary.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{secondary}</div> : null}
    </div>
  );
}
