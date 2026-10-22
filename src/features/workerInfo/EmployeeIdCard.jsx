/**
 * AKK Engineering Employee Identification Card. Pure display: give it a worker's card data
 * ({ employee_id, name, work_permit_no, designation, worker_type, in_company, photo }).
 * Shows no sensitive details (no passport, address, phone).
 */
import { initialsOf } from '@/ui/photo';
import './workerInfo.css';

export default function EmployeeIdCard({ card, className = '', footer }) {
    if (!card) return null;
    const employed = card.in_company !== false;
    const wp = card.worker_type === 'local' ? null : card.work_permit_no;
    return (
        <article className={`eic ${className}`} data-status={employed ? 'active' : 'left'} aria-label={`Employee identification card of ${card.name}`}>
            <header className="eic__band">
                <span className="eic__logo">
                    <img src="/Akk-logo.png" alt="" />
                </span>
                <span className="eic__org">
                    <b>AKK ENGINEERING PTE. LTD.</b>
                    <span>EMPLOYEE IDENTIFICATION CARD</span>
                </span>
            </header>
            <div className="eic__body">
                <div className="eic__photo">
                    {card.photo ? <img src={card.photo} alt={`Photo of ${card.name}`} /> : <span className="eic__initials">{initialsOf(card.name)}</span>}
                </div>
                <div className="eic__info">
                    <span className="eic__label">Name</span>
                    <p className="eic__name">{card.name || '—'}</p>
                    <div className="eic__grid">
                        <div>
                            <span className="eic__label">Employee ID</span>
                            <span className="eic__value eic__value--mono">{card.employee_id}</span>
                        </div>
                        <div>
                            <span className="eic__label">{card.worker_type === 'local' ? 'Type' : 'Work Permit No.'}</span>
                            {card.worker_type === 'local' ? (
                                <span className="eic__value">Local staff</span>
                            ) : (
                                <span className={`eic__value eic__value--mono ${wp ? '' : 'eic__value--muted'}`}>{wp || 'Not on file'}</span>
                            )}
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <span className="eic__label">Designation</span>
                            <span className="eic__value">{card.designation || '—'}</span>
                        </div>
                    </div>
                </div>
            </div>
            <footer className="eic__foot">
                <span className="eic__status">{employed ? 'Active employee' : 'Not in company'}</span>
                {footer || <span className="eic__micro">Property of AKK Engineering</span>}
            </footer>
        </article>
    );
}
