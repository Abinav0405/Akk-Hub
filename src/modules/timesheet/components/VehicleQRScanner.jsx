import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import LiveQrCamera from '@/modules/timesheet/components/LiveQrCamera';
import { getVehicleByQrToken } from '@/modules/timesheet/lib/vehicleService';
import { captureCurrentPosition } from '@/modules/timesheet/lib/vehicleTracking';
import {
    ensureVehicleLocationPermission,
    getGpsErrorMessage,
} from '@/modules/timesheet/lib/vehicleTrackingNotification';

const VehicleQRScanner = ({
    onScanSuccess,
    onValidationFailure,
    disabled = false,
    requireGps = true,
}) => {
    const [isValidating, setIsValidating] = useState(false);
    const [gpsAccuracy, setGpsAccuracy] = useState(null);
    const [locationReady, setLocationReady] = useState(false);
    const scannedDataRef = useRef(null);
    const currentLocationRef = useRef(null);
    const capWatchIdRef = useRef(null);

    const reportValidationFailure = (title, subtitle) => {
        toast.error(subtitle || title);
        onValidationFailure?.({ title, subtitle: subtitle || undefined });
    };

    useEffect(() => {
        let browserWatchId = null;
        let cancelled = false;
        let lastUi = 0;

        const applyCoords = (coords) => {
            if (cancelled || !coords) return;
            currentLocationRef.current = coords;
            const now = Date.now();
            if (now - lastUi > 2000) {
                lastUi = now;
                setGpsAccuracy(coords.accuracy);
                setLocationReady(true);
            }
        };

        const startNativeWatch = async () => {
            const ok = await ensureVehicleLocationPermission();
            if (cancelled || !ok) return;
            try {
                const { Geolocation } = await import('@capacitor/geolocation');
                capWatchIdRef.current = await Geolocation.watchPosition(
                    { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
                    (position, err) => {
                        if (cancelled || err || !position?.coords) return;
                        applyCoords({
                            latitude: position.coords.latitude,
                            longitude: position.coords.longitude,
                            accuracy: position.coords.accuracy,
                        });
                    },
                );
            } catch {
                /* captureCurrentPosition still runs at scan time */
            }
        };

        if (Capacitor.isNativePlatform()) {
            void startNativeWatch();
        } else if (navigator.geolocation) {
            browserWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    applyCoords({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                    });
                },
                () => {},
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
            );
        }

        return () => {
            cancelled = true;
            if (browserWatchId != null) navigator.geolocation.clearWatch(browserWatchId);
            if (capWatchIdRef.current != null) {
                const watchId = capWatchIdRef.current;
                capWatchIdRef.current = null;
                import('@capacitor/geolocation').then(({ Geolocation }) => {
                    Geolocation.clearWatch({ id: watchId }).catch(() => {});
                });
            }
        };
    }, []);

    const onDecoded = async (decodedText) => {
        if (scannedDataRef.current || disabled) return;
        scannedDataRef.current = decodedText;
        setIsValidating(true);

        try {
            const vehicle = await getVehicleByQrToken(decodedText);
            if (!vehicle) {
                reportValidationFailure(
                    'Invalid vehicle QR',
                    'This QR code is not registered to an active vehicle.',
                );
                return;
            }

            let coords = currentLocationRef.current;
            try {
                coords = await captureCurrentPosition();
                currentLocationRef.current = coords;
                if (coords?.accuracy != null) {
                    setGpsAccuracy(coords.accuracy);
                    setLocationReady(true);
                }
            } catch (err) {
                if (requireGps && (!coords?.latitude || !coords?.longitude)) {
                    reportValidationFailure('Location unavailable', getGpsErrorMessage(err));
                    return;
                }
            }

            onScanSuccess?.(vehicle, decodedText, coords);
        } catch (error) {
            console.error('Vehicle scan validation error', error);
            reportValidationFailure('Scan unsuccessful', error.message || 'Validation failed.');
        } finally {
            scannedDataRef.current = null;
            setIsValidating(false);
        }
    };

    const gpsLabel = locationReady && gpsAccuracy != null
        ? `GPS ±${Math.round(gpsAccuracy)}m`
        : 'Getting location…';

    return (
        <LiveQrCamera
            onDecoded={onDecoded}
            disabled={disabled}
            busy={isValidating}
            hint="Point the camera at the vehicle QR"
            gpsLabel={gpsLabel}
        />
    );
};

export default VehicleQRScanner;
