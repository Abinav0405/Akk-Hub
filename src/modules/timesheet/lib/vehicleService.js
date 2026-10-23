import { supabaseTimesheet } from '@/core/supabase'
import { computeJourneyStats, computeRouteDistanceKm } from '@/modules/timesheet/lib/vehicleJourneyStats';

export function generateVehicleQrToken(vehicleNumber) {
    const base = String(vehicleNumber || 'VEHICLE')
        .trim()
        .replace(/\s+/g, '_')
        .toUpperCase();
    // Random suffix so QR tokens are not guessable from the plate number alone.
    const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
            : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    return `${base}_VEHICLE_${rand}`;
}

export async function listVehicles() {
    const { data, error } = await supabaseTimesheet
        .from('vehicles')
        .select('*')
        .order('vehicle_number', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function createVehicle({ vehicle_number, description }) {
    const number = String(vehicle_number || '').trim().toUpperCase();
    if (!number) throw new Error('Vehicle number is required');

    const qr_token = generateVehicleQrToken(number);
    const { data, error } = await supabaseTimesheet
        .from('vehicles')
        .insert([{
            vehicle_number: number,
            qr_token,
            description: description?.trim() || null,
            is_active: true,
            updated_at: new Date().toISOString(),
        }])
        .select()
        .single();
    if (error) {
        if (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')) {
            throw new Error(`Vehicle ${number} already exists.`);
        }
        throw error;
    }
    return data;
}

export async function updateVehicle(id, patch) {
    const { data, error } = await supabaseTimesheet
        .from('vehicles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deactivateVehicle(id) {
    return updateVehicle(id, { is_active: false });
}

/** New QR for a vehicle (old stickers stop working — e.g. a sticker was lost or copied). */
export async function regenerateVehicleQr(vehicle) {
    return updateVehicle(vehicle.id, { qr_token: generateVehicleQrToken(vehicle.vehicle_number) });
}

export async function countVehicleJourneys(vehicleId) {
    const { count, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId);
    if (error) throw error;
    return count || 0;
}

/** Permanently remove a vehicle and its journey history. Blocked while a journey is active. */
export async function deleteVehicle(id) {
    const active = await getActiveJourneyForVehicle(id);
    if (active) {
        throw new Error('Cannot delete — this vehicle has an active journey in progress.');
    }

    const { error: journeyErr } = await supabaseTimesheet
        .from('vehicle_journeys')
        .delete()
        .eq('vehicle_id', id);
    if (journeyErr) throw journeyErr;

    const { error } = await supabaseTimesheet.from('vehicles').delete().eq('id', id);
    if (error) throw error;
}

export async function getVehicleByQrToken(qrToken) {
    const { data, error } = await supabaseTimesheet
        .from('vehicles')
        .select('*')
        .eq('qr_token', qrToken)
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function getActiveJourneyForWorker(workerId, workerType) {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .select('*, vehicles(*)')
        .eq('worker_id', workerId)
        .eq('worker_type', workerType)
        .in('status', ['active', 'on_break'])
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function getActiveJourneyForVehicle(vehicleId) {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .select('*, vehicles(*)')
        .eq('vehicle_id', vehicleId)
        .in('status', ['active', 'on_break'])
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function listActiveJourneys() {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .select('*, vehicles(*)')
        .in('status', ['active', 'on_break'])
        .order('started_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

/** Completed journeys, newest first. `from` / `to` are YYYY-MM-DD (Singapore days, by start time). */
export async function listCompletedJourneys({ limit = 50, from = null, to = null, vehicleId = null } = {}) {
    let query = supabaseTimesheet
        .from('vehicle_journeys')
        .select('*, vehicles(*)')
        .eq('status', 'completed');
    if (from) query = query.gte('started_at', `${from}T00:00:00+08:00`);
    if (to) query = query.lte('started_at', `${to}T23:59:59.999+08:00`);
    if (vehicleId) query = query.eq('vehicle_id', vehicleId);
    const { data, error } = await query.order('ended_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
}

/** GPS point count + last point time per journey (for "GPS quality" in the admin list). */
export async function getJourneyGpsSummary(journeyIds) {
    const out = {};
    await Promise.all(
        (journeyIds || []).map(async (id) => {
            const { count } = await supabaseTimesheet.from('vehicle_location_points').select('id', { count: 'exact', head: true }).eq('journey_id', id);
            out[id] = { points: count || 0 };
        }),
    );
    return out;
}

export async function getJourneyById(journeyId) {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .select('*, vehicles(*)')
        .eq('id', journeyId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/** Permanently delete a journey and its GPS route / breaks (cascade). */
export async function deleteJourney(journeyId) {
    if (!journeyId) throw new Error('Journey id is required');
    const { error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .delete()
        .eq('id', journeyId);
    if (error) throw error;
}

// PostgREST returns at most 1000 rows per request, so a long ride must be fetched in pages —
// otherwise distance/top speed are computed from a truncated route and the live marker freezes.
const POINTS_PAGE_SIZE = 1000;
const POINTS_MAX_PAGES = 60;

/** All GPS points for a journey in time order. Pass `after` (a recorded_at value) to fetch only newer points. */
export async function getJourneyPoints(journeyId, { after = null } = {}) {
    const all = [];
    for (let page = 0; page < POINTS_MAX_PAGES; page += 1) {
        const from = page * POINTS_PAGE_SIZE;
        let query = supabaseTimesheet
            .from('vehicle_location_points')
            .select('*')
            .eq('journey_id', journeyId);
        if (after) query = query.gt('recorded_at', after);
        const { data, error } = await query
            .order('recorded_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + POINTS_PAGE_SIZE - 1);
        if (error) throw error;
        const rows = data || [];
        all.push(...rows);
        if (rows.length < POINTS_PAGE_SIZE) break;
    }
    return all;
}

export async function getJourneyBreaks(journeyId) {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journey_breaks')
        .select('*')
        .eq('journey_id', journeyId)
        .order('break_start', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function getLatestLocationPoint(journeyId) {
    const { data, error } = await supabaseTimesheet
        .from('vehicle_location_points')
        .select('*')
        .eq('journey_id', journeyId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

function pointRow(journeyId, coords) {
    const lat = Number(coords.latitude);
    const lng = Number(coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const speedMs = coords.speed != null ? Number(coords.speed) : null;
    const speedKmh = speedMs != null && Number.isFinite(speedMs) && speedMs >= 0 ? speedMs * 3.6 : null;
    // Stamp the point with when the GPS fix was taken, not when the upload happened (points can wait
    // in the offline queue). Ignore implausible fix times (future, or older than a day).
    const fixMs = Number(coords.timestamp);
    const now = Date.now();
    const recordedAt =
        Number.isFinite(fixMs) && fixMs > 0 && fixMs <= now + 60 * 1000 && now - fixMs < 24 * 3600 * 1000
            ? new Date(fixMs).toISOString()
            : new Date(now).toISOString();
    const heading = coords.heading != null ? Number(coords.heading) : null;
    return {
        journey_id: journeyId,
        latitude: lat,
        longitude: lng,
        accuracy_m: coords.accuracy != null && Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
        speed_kmh: speedKmh,
        heading: Number.isFinite(heading) ? heading : null,
        recorded_at: recordedAt,
    };
}

export async function insertLocationPoint(journeyId, coords) {
    const row = pointRow(journeyId, coords);
    if (!row) return null;
    const { data, error } = await supabaseTimesheet.from('vehicle_location_points').insert([row]).select().single();
    if (error) throw error;
    return data;
}

/** Batch upload (offline queue). */
export async function insertLocationPoints(journeyId, coordsList) {
    const rows = (coordsList || []).map((c) => pointRow(journeyId, c)).filter(Boolean);
    if (!rows.length) return 0;
    const { error } = await supabaseTimesheet.from('vehicle_location_points').insert(rows);
    if (error) throw error;
    return rows.length;
}

function isUniqueViolation(error) {
    return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message || '');
}

export async function startJourney({ vehicleId, workerId, workerType, workerName, lat, lng }) {
    const existingVehicle = await getActiveJourneyForVehicle(vehicleId);
    if (existingVehicle) {
        throw new Error(
            `Vehicle is already in use by ${existingVehicle.worker_name || existingVehicle.worker_id}`
        );
    }

    const existingWorker = await getActiveJourneyForWorker(workerId, workerType);
    if (existingWorker) {
        throw new Error('Finish your current vehicle journey before starting another.');
    }

    const startedAt = new Date().toISOString();
    const { data: journey, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .insert([{
            vehicle_id: vehicleId,
            worker_id: workerId,
            worker_type: workerType,
            worker_name: workerName,
            status: 'active',
            started_at: startedAt,
            start_latitude: lat,
            start_longitude: lng,
        }])
        .select('*, vehicles(*)')
        .single();

    if (error) {
        // Race: another device won the unique partial index — resolve to existing row.
        if (isUniqueViolation(error)) {
            const workerJourney = await getActiveJourneyForWorker(workerId, workerType);
            if (workerJourney) {
                if (workerJourney.vehicle_id === vehicleId) return workerJourney;
                throw new Error('Finish your current vehicle journey before starting another.');
            }
            const vehicleJourney = await getActiveJourneyForVehicle(vehicleId);
            if (vehicleJourney) {
                throw new Error(
                    `Vehicle is already in use by ${vehicleJourney.worker_name || vehicleJourney.worker_id}`
                );
            }
            throw new Error('Could not start journey — an active journey already exists.');
        }
        throw error;
    }

    if (lat != null && lng != null) {
        await insertLocationPoint(journey.id, { latitude: lat, longitude: lng, accuracy: 0 });
    }

    return journey;
}

export async function startBreak(journeyId, { lat, lng }) {
    const journey = await getJourneyById(journeyId);
    if (!journey) throw new Error('Journey not found');
    if (journey.status === 'completed') throw new Error('This journey is already completed.');
    // Idempotent: already on break (e.g. double-tap).
    if (journey.status === 'on_break') return journey;

    const { data: existingOpen, error: openFindErr } = await supabaseTimesheet
        .from('vehicle_journey_breaks')
        .select('id')
        .eq('journey_id', journeyId)
        .is('break_end', null)
        .limit(1)
        .maybeSingle();
    if (openFindErr) throw openFindErr;

    // Claim break status first so concurrent taps cannot both insert open breaks.
    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .update({ status: 'on_break' })
        .eq('id', journeyId)
        .eq('status', 'active')
        .select('*, vehicles(*)')
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        const latest = await getJourneyById(journeyId);
        if (latest?.status === 'on_break') return latest;
        throw new Error('Could not start break. Please try again.');
    }

    if (existingOpen) return data;

    const now = new Date().toISOString();
    const { error: breakErr } = await supabaseTimesheet
        .from('vehicle_journey_breaks')
        .insert([{
            journey_id: journeyId,
            break_start: now,
            latitude: lat ?? null,
            longitude: lng ?? null,
        }]);
    if (breakErr) {
        // Roll back status so the driver is not stuck "on break" without a break row.
        await supabaseTimesheet
            .from('vehicle_journeys')
            .update({ status: 'active' })
            .eq('id', journeyId)
            .eq('status', 'on_break');
        throw breakErr;
    }
    return data;
}

export async function endBreak(journeyId) {
    const now = new Date().toISOString();
    // Close every open break row (guards against rare duplicates from older clients).
    await closeOpenBreaksForJourney(journeyId, now);

    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .update({ status: 'active' })
        .eq('id', journeyId)
        .in('status', ['active', 'on_break'])
        .select('*, vehicles(*)')
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        const latest = await getJourneyById(journeyId);
        if (latest?.status === 'active') return latest;
        if (latest?.status === 'completed') {
            throw new Error('This journey is already completed.');
        }
        throw new Error('Could not end break. Please try again.');
    }
    return data;
}

/** Close any open break rows at endedAt so break time is not counted as moving (VEH-02). */
async function closeOpenBreaksForJourney(journeyId, endedAt) {
    const { data: openBreaks, error: findErr } = await supabaseTimesheet
        .from('vehicle_journey_breaks')
        .select('*')
        .eq('journey_id', journeyId)
        .is('break_end', null);
    if (findErr) throw findErr;
    if (!openBreaks?.length) return;

    const endMs = new Date(endedAt).getTime();
    for (const openBreak of openBreaks) {
        const durationSeconds = Math.max(
            0,
            Math.floor((endMs - new Date(openBreak.break_start).getTime()) / 1000)
        );
        const { error: updErr } = await supabaseTimesheet
            .from('vehicle_journey_breaks')
            .update({ break_end: endedAt, duration_seconds: durationSeconds })
            .eq('id', openBreak.id);
        if (updErr) throw updErr;
    }
}

export async function endJourney(journeyId, { lat, lng } = {}) {
    // Points still waiting in this device's offline queue belong in the distance / speed figures.
    try {
        const { flushVehicleTrackingQueue } = await import('@/modules/timesheet/lib/vehicleTracking');
        await Promise.race([flushVehicleTrackingQueue(), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
        /* ignore — the queue is retried later */
    }
    const endedAt = new Date().toISOString();
    await closeOpenBreaksForJourney(journeyId, endedAt);

    // Record the arrival point (mirrors startJourney) so the final leg counts towards distance.
    if (lat != null && lng != null) {
        try {
            await insertLocationPoint(journeyId, { latitude: lat, longitude: lng, accuracy: null });
        } catch (e) {
            console.warn('Could not record end point', e);
        }
    }

    let points = [];
    let breaks = [];
    try {
        points = await getJourneyPoints(journeyId);
    } catch (e) {
        console.error('Could not load GPS points for journey stats', e);
    }
    try {
        breaks = await getJourneyBreaks(journeyId);
    } catch (e) {
        console.error('Could not load breaks for journey stats', e);
    }

    const journey = await getJourneyById(journeyId);
    if (!journey) throw new Error('Journey not found');

    const stats = computeJourneyStats({
        points,
        startedAt: journey.started_at,
        endedAt,
        breaks,
    });

    const { data, error } = await supabaseTimesheet
        .from('vehicle_journeys')
        .update({
            status: 'completed',
            ended_at: endedAt,
            end_latitude: lat ?? null,
            end_longitude: lng ?? null,
            total_distance_km: stats.total_distance_km,
            duration_seconds: stats.duration_seconds,
            avg_speed_kmh: stats.avg_speed_kmh,
            top_speed_kmh: stats.top_speed_kmh,
        })
        .eq('id', journeyId)
        .in('status', ['active', 'on_break'])
        .select('*, vehicles(*)')
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        const latest = await getJourneyById(journeyId);
        if (latest?.status === 'completed') return latest;
        throw new Error('Could not complete the journey. Please try Finish ride again.');
    }
    return data;
}

export async function getLiveDistanceKm(journeyId) {
    const points = await getJourneyPoints(journeyId);
    return computeRouteDistanceKm(points);
}
