/**
 * Supervisor / manager / admin: hand a vehicle to a driver by card — scan the vehicle QR, then the
 * driver's ID card, then Start (or End) the journey for that driver. The journey belongs to the driver's
 * identity on the card; their own phone (AKK Hub app or website) picks it up and records GPS as soon as
 * they open AKK Hub.
 */
import { useState } from 'react';
import { Car, Flag, Loader2, Play, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import LiveQrCamera from '@/modules/timesheet/components/LiveQrCamera';
import { endJourney, getActiveJourneyForVehicle, getActiveJourneyForWorker, getVehicleByQrToken, startJourney } from '@/modules/timesheet/lib/vehicleService';
import { cardsScan } from './api';
import CardScanner from './CardScanner';
import { CardFront } from './CardFaces';

const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : '');

export default function VehicleByCard({ onNext }) {
    const [vehicle, setVehicle] = useState(null);
    const [vehicleJourney, setVehicleJourney] = useState(null);
    const [driver, setDriver] = useState(null); // verify result
    const [driverJourney, setDriverJourney] = useState(null);
    const [busy, setBusy] = useState(false);
    const [nonce, setNonce] = useState(0);
    const [done, setDone] = useState('');

    const onVehicle = async (text) => {
        setBusy(true);
        try {
            const v = await getVehicleByQrToken(String(text || '').trim());
            if (!v) throw new Error('Not an AKK vehicle QR (or the vehicle is switched off).');
            setVehicle(v);
            setVehicleJourney(await getActiveJourneyForVehicle(v.id));
        } catch (e) {
            toast.error(e.message);
            setNonce((n) => n + 1);
        } finally {
            setBusy(false);
        }
    };

    const onCard = async (code) => {
        setBusy(true);
        try {
            const r = await cardsScan.verify(code, 'vehicle');
            if (!r.found) throw new Error(r.message || 'Not an AKK card');
            setDriver(r);
            setDriverJourney(await getActiveJourneyForWorker(r.card.employee_id, r.card.worker_type));
        } catch (e) {
            toast.error(e.message);
            setNonce((n) => n + 1);
        } finally {
            setBusy(false);
        }
    };

    if (!vehicle) {
        return (
            <div className="space-y-2">
                <p className="text-center text-sm font-semibold text-slate-700">Step 1 of 2 — scan the vehicle QR</p>
                <LiveQrCamera
                    key={nonce}
                    onDecoded={onVehicle}
                    accept={(text) => /_VEHICLE_/.test(String(text || ''))}
                    rejectHint="That's not an AKK vehicle QR — point at the sticker in the vehicle."
                    busy={busy}
                    hint="Point the camera at the vehicle QR sticker"
                />
            </div>
        );
    }

    const head = (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--g-hairline)] bg-white p-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#dc6b2f]">
                <Car className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{vehicle.vehicle_number}</span>
                <span className="block truncate text-xs text-slate-500">
                    {vehicleJourney ? `In use by ${vehicleJourney.worker_name || vehicleJourney.worker_id} since ${hm(vehicleJourney.started_at)}` : vehicle.description || 'Free'}
                </span>
            </span>
        </div>
    );

    if (!driver) {
        return (
            <div className="space-y-3">
                {head}
                <p className="text-center text-sm font-semibold text-slate-700">Step 2 of 2 — scan the driver&apos;s ID card</p>
                <CardScanner key={nonce} onCode={onCard} busy={busy} hint="Scan the driver's ID card" />
            </div>
        );
    }

    const card = driver.card;
    const stale = driver.method === 'live' && driver.live === false;
    const invalid = card.state !== 'valid' || stale;
    const sameJourney = driverJourney && vehicleJourney && driverJourney.id === vehicleJourney.id;
    const otherVehicle = driverJourney && !sameJourney;
    const vehicleBusy = vehicleJourney && !sameJourney;

    const start = async () => {
        setBusy(true);
        try {
            await startJourney({ vehicleId: vehicle.id, workerId: card.employee_id, workerType: card.worker_type, workerName: card.name, lat: null, lng: null });
            setDone(`Journey started — ${card.name} is driving ${vehicle.vehicle_number}. GPS starts when they open AKK Hub on their phone.`);
            setDriverJourney(await getActiveJourneyForWorker(card.employee_id, card.worker_type));
            setVehicleJourney(await getActiveJourneyForVehicle(vehicle.id));
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };
    const end = async () => {
        setBusy(true);
        try {
            const j = await endJourney(vehicleJourney.id, {});
            setDone(`Journey ended — ${Number(j?.total_distance_km || 0).toFixed(1)} km.`);
            setDriverJourney(null);
            setVehicleJourney(null);
        } catch (e) {
            toast.error(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            {head}
            <div className="mx-auto w-full max-w-[400px]">
                <CardFront card={card} />
            </div>
            {invalid ? (
                <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
                    {stale ? 'Old code — ask the driver for the live card in the app.' : driver.checks?.[0]?.text || 'This card is not valid.'}
                </p>
            ) : null}
            {otherVehicle ? (
                <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
                    {card.name} is already driving {driverJourney.vehicles?.vehicle_number || 'another vehicle'} — end that journey first.
                </p>
            ) : null}
            {vehicleBusy ? (
                <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
                    {vehicle.vehicle_number} is in use by {vehicleJourney.worker_name || vehicleJourney.worker_id}. Scan that driver&apos;s card to end it.
                </p>
            ) : null}
            {done ? <p className="akc-verdict rounded-xl bg-emerald-600 p-3 text-center text-sm font-semibold text-white">{done}</p> : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button type="button" className="h-12" disabled={busy || invalid || !!driverJourney || !!vehicleJourney} onClick={start}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />} Start journey
                </Button>
                <Button type="button" variant="outline" className="h-12" disabled={busy || !sameJourney} onClick={end}>
                    <Flag className="mr-2 h-4 w-4" /> End journey
                </Button>
            </div>
            <Button type="button" variant="ghost" className="h-11 w-full" onClick={onNext}>
                <ScanLine className="mr-2 h-4 w-4" /> Another vehicle
            </Button>
        </div>
    );
}
