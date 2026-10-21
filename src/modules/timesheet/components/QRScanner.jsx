import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import LiveQrCamera from '@/modules/timesheet/components/LiveQrCamera';
import { calculateDistance, parseSiteGpsCoords } from '@/modules/timesheet/lib/timeUtils';
import { supabaseTimesheet } from '@/core/supabase'

function readGpsOnce() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Location is not available on this device.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
            }),
            reject,
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
        );
    });
}

const QRScanner = ({
    onScanSuccess,
    onValidationFailure,
    requiredDistance = 350,
    action = 'scan',
    currentShiftSiteId = null,
    disabled = false,
}) => {
    const [isValidating, setIsValidating] = useState(false);
    const [gpsAccuracy, setGpsAccuracy] = useState(null);
    const [locationReady, setLocationReady] = useState(false);
    const currentLocationRef = useRef(null);
    const locationPermissionRef = useRef(null);
    const scannedDataRef = useRef(null);

    const reportValidationFailure = (title, subtitle) => {
        toast.error(subtitle || title);
        onValidationFailure?.({ title, subtitle: subtitle || undefined });
    };

    useEffect(() => {
        let locationWatchId = null;
        let lastUi = 0;
        if (!navigator.geolocation) return undefined;

        locationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const loc = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                };
                currentLocationRef.current = loc;
                locationPermissionRef.current = true;
                const now = Date.now();
                if (now - lastUi > 2000) {
                    lastUi = now;
                    setGpsAccuracy(loc.accuracy);
                    setLocationReady(true);
                }
            },
            (error) => {
                if (error?.code === 1) {
                    locationPermissionRef.current = false;
                    setLocationReady(false);
                }
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
        );

        return () => {
            if (locationWatchId != null) navigator.geolocation.clearWatch(locationWatchId);
        };
    }, []);

    const onDecoded = async (decodedText) => {
        if (scannedDataRef.current || disabled) return;
        scannedDataRef.current = decodedText;
        setIsValidating(true);

        try {
            const { data: site, error: siteError } = await supabaseTimesheet
                .from('sites')
                .select('*')
                .eq('qr_token', decodedText)
                .single();

            if (siteError || !site) {
                reportValidationFailure(
                    'Invalid QR code',
                    'This code is not registered for a work site.',
                );
                return;
            }

            // New clock-ins must use an active attendance site; history/clock-out can still resolve names.
            if (action === 'scan' && site.is_active === false) {
                reportValidationFailure(
                    'Site inactive',
                    'This site is switched off for attendance. Ask an admin to turn it back on.',
                );
                return;
            }

            if ((action === 'leave' || action === 'lunch' || action === 'breaks') && currentShiftSiteId && currentShiftSiteId !== site.id) {
                reportValidationFailure(
                    'Wrong site',
                    `Use the QR at the same site as your shift (${action === 'leave' ? 'clock out' : 'break'}).`,
                );
                return;
            }

            // Number(null)===0 used to pass “has GPS” and compare against Null Island (~11,500 km).
            const siteGps = parseSiteGpsCoords(site);
            if (!siteGps) {
                reportValidationFailure(
                    'Site GPS not configured',
                    'This site has no coordinates. Ask an admin to set latitude and longitude on Admin → Sites before clock-in.',
                );
                return;
            }

            if (locationPermissionRef.current === false) {
                reportValidationFailure(
                    'Location required',
                    'Enable location permission to verify you are on site.',
                );
                return;
            }

            let loc = currentLocationRef.current;
            if (!loc) {
                try {
                    loc = await readGpsOnce();
                    currentLocationRef.current = loc;
                    locationPermissionRef.current = true;
                    setGpsAccuracy(loc.accuracy);
                    setLocationReady(true);
                } catch {
                    reportValidationFailure(
                        'Location unavailable',
                        'Wait for GPS or enable location services, then try again.',
                    );
                    return;
                }
            }

            const distance = calculateDistance(
                loc.latitude,
                loc.longitude,
                siteGps.latitude,
                siteGps.longitude,
            );

            if (distance > requiredDistance) {
                const d = Math.round(distance);
                const absurd = distance > 50000;
                reportValidationFailure(
                    'Too far from site',
                    absurd
                        ? `${d} m away — site GPS looks wrong (not within ${requiredDistance} m). Ask an admin to fix latitude/longitude on Admin → Sites.`
                        : `${d} m away — move within ${requiredDistance} m of the site (GPS).`,
                );
                return;
            }

            onScanSuccess && onScanSuccess(site, decodedText);
        } catch (error) {
            console.error('Scan validation error:', error);
            reportValidationFailure(
                'Scan unsuccessful',
                'Validation failed. Try again or check your connection.',
            );
        } finally {
            scannedDataRef.current = null;
            setIsValidating(false);
        }
    };

    const gpsLabel = locationReady && gpsAccuracy != null
        ? `GPS ±${Math.round(gpsAccuracy)}m${gpsAccuracy > 50 ? ' · move outdoors if it stays high' : ''}`
        : 'Getting location…';

    return (
        <LiveQrCamera
            onDecoded={onDecoded}
            disabled={disabled}
            busy={isValidating}
            hint="Point the camera at the site QR"
            gpsLabel={gpsLabel}
        />
    );
};

export default QRScanner;
