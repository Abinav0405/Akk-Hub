import React, { useState } from 'react';
import { storageKey } from '@/core/storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import {
    History as HistoryIcon, ArrowLeft, Calendar, Clock,
    MapPin, Coffee, CheckCircle, ChevronDown, ChevronUp
} from "lucide-react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";
import { supabaseTimesheet as supabase } from '@/core/supabase';
import { formatTime, formatDate, calculateShiftHours, isSunday, isPublicHoliday } from '@/modules/timesheet/lib/timeUtils';

// Helper function to calculate break hours
const calculateBreakHours = (breaks) => {
    if (!breaks || breaks.length === 0) return 0;
    
    return breaks.reduce((total, breakRecord) => {
        const start = new Date(breakRecord.break_start);
        const end = new Date(breakRecord.break_end);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const diffMs = end - start;
            return total + (diffMs / (1000 * 60 * 60)); // Convert to hours
        }
        return total;
    }, 0);
};

export default function History() {
    const navigate = useNavigate();
    const [expandedCards, setExpandedCards] = useState(new Set());

    const workerId = localStorage.getItem(storageKey('timesheet', 'workerId'));
    const workerName = localStorage.getItem(storageKey('timesheet', 'workerName'));

    // Staff route (/timesheet/history) — RequireHubRole already gates manager/admin.
    // Prefer hub staff homes for back; never send staff to /timesheet/clock → /me (worker-only).
    const isAdmin =
        localStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true' ||
        sessionStorage.getItem(storageKey('timesheet', 'adminLoggedIn')) === 'true';
    const isManager = localStorage.getItem(storageKey('timesheet', 'managerLoggedIn')) === 'true';
    const backTo = isAdmin ? '/admin' : isManager ? '/manage' : '/me';

    // Do not bounce on missing workerLoggedIn (that flag is employee-only and caused
    // false /login redirects for hub-authenticated managers).
    React.useEffect(() => {
        if (isAdmin || isManager) return;
        const workerLoggedIn = localStorage.getItem(storageKey('timesheet', 'workerLoggedIn'));
        if (!workerLoggedIn) {
            navigate('/login', { replace: true });
        }
    }, [navigate, isAdmin, isManager]);

    // Fetch shift history
    const { data: shifts = [], isLoading } = useQuery({
        queryKey: ['shiftHistory', workerId],
        queryFn: async () => {
            if (!workerId) return [];

            const { data, error } = await supabase
                .from('shifts')
                .select('*')
                .eq('worker_id', workerId)
                .order('work_date', { ascending: false });

            if (error) {
                console.error('🔍 Error fetching shifts:', error);
                throw error;
            }

            // If we have shifts, fetch related site data and breaks separately
            if (data && data.length > 0) {
                const siteIds = [...new Set(data.map(shift => shift.site_id))];
                const shiftIds = [...new Set(data.map(shift => shift.id))];

                // Fetch sites
                const { data: sites } = await supabase
                    .from('sites')
                    .select('id, site_name, latitude, longitude')
                    .in('id', siteIds);

                // Fetch breaks for all shifts
                const { data: breaks } = await supabase
                    .from('breaks')
                    .select('*')
                    .in('shift_id', shiftIds)
                    .order('break_start', { ascending: true });

                // Group breaks by shift_id
                const breaksByShiftId = {};
                if (breaks) {
                    breaks.forEach(breakRecord => {
                        if (!breaksByShiftId[breakRecord.shift_id]) {
                            breaksByShiftId[breakRecord.shift_id] = [];
                        }
                        breaksByShiftId[breakRecord.shift_id].push(breakRecord);
                    });
                }

                // Merge site and break data into shifts
                const shiftsWithData = data.map(shift => ({
                    ...shift,
                    sites: sites?.find(s => s.id === shift.site_id) || null,
                    breaks: breaksByShiftId[shift.id] || []
                }));

                return shiftsWithData;
            }

            return data || [];
        },
        enabled: !!workerId
    });

    const toggleCardExpansion = (shiftId) => {
        const newExpanded = new Set(expandedCards);
        if (newExpanded.has(shiftId)) {
            newExpanded.delete(shiftId);
        } else {
            newExpanded.add(shiftId);
        }
        setExpandedCards(newExpanded);
    };

    const getCorrectedHours = (shift) => {
        const workedHours = shift.worked_hours || 0;
        const sundayHours = shift.sunday_hours || 0;
        const otHours = shift.ot_hours || 0;
        const breakHours = calculateBreakHours(shift.breaks);

        return { workedHours, sundayHours, otHours, breakHours };
    };

    const getTotalHours = () => {
        let totalWorked = 0;
        let totalSunday = 0;
        let totalOT = 0;
        let totalBreak = 0;

        // Get current month
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        shifts.forEach(shift => {
            if (shift.has_left) {
                // Check if shift is from current month
                const shiftDate = new Date(shift.work_date);
                const isCurrentMonth = shiftDate.getMonth() === currentMonth && 
                                     shiftDate.getFullYear() === currentYear;
                
                if (isCurrentMonth) {
                    const corrected = getCorrectedHours(shift);
                    totalWorked += corrected.workedHours;
                    totalSunday += corrected.sundayHours;
                    totalOT += corrected.otHours;
                    totalBreak += corrected.breakHours;
                }
            }
        });

        return { totalWorked, totalSunday, totalOT, totalBreak };
    };

    const totals = getTotalHours();

    return (
        <div className="min-h-dvh-safe bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200">
            {/* Header */}
            <header className="bg-[#dc6b2f] px-safe pb-6 pt-[max(1.5rem,env(safe-area-inset-top,0px))] text-white shadow-lg">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link to={backTo}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-white hover:bg-white/10"
                                aria-label="Back"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                        </Link>
                                <img
                            src="/Akk-logo.jpg"
                            alt="AKK Engineering Logo"
                            className="h-12 w-12 md:h-16 md:w-16 object-contain"
                        />
                        <div>
                            <h1
                                className="text-2xl md:text-3xl font-bold tracking-tight"
                                style={{ fontFamily: 'Calibri, sans-serif' }}
                            >
                                Shift History
                            </h1>
                            <p
                                className="text-slate-300 text-xs mt-1"
                                style={{ fontFamily: 'Aptos Narrow, Aptos, sans-serif' }}
                            >
                                15 Kaki Bukit Rd 4, #01-50, Singapore 417808
                            </p>
                        </div>
                    </div>

                    {/* Worker Info */}
                    <div className="text-right hidden sm:block">
                        <p className="font-medium">{workerName}</p>
                        <p className="text-sm text-slate-300">ID: {workerId}</p>
                    </div>
                </div>
            </header>

            {/* Summary */}
            <div className="mx-auto max-w-6xl px-safe pb-6">
                <div className="mb-4 text-center">
                    <h2 className="text-lg font-semibold text-slate-700">
                        {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} Summary
                    </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-blue-600">{totals.totalWorked.toFixed(2)}</p>
                                <p className="text-sm text-slate-600">Regular Hours</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-orange-600">{totals.totalSunday.toFixed(2)}</p>
                                <p className="text-sm text-slate-600">Sunday Hours</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-green-600">{totals.totalOT.toFixed(2)}</p>
                                <p className="text-sm text-slate-600">OT Hours</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-purple-600">{totals.totalBreak.toFixed(2)}</p>
                                <p className="text-sm text-slate-600">Break Hours</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Shifts List */}
            <div className="mx-auto max-w-6xl px-safe pb-[calc(6rem+env(safe-area-inset-bottom,0px))]">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#dc6b2f]"></div>
                    </div>
                ) : shifts.length === 0 ? (
                    <Card className="border-0 shadow-lg">
                        <CardContent className="py-20 text-center">
                            <HistoryIcon className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                            <h3 className="text-xl font-semibold text-slate-700 mb-2">No Shifts Found</h3>
                            <p className="text-slate-500">No shifts recorded for this worker.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {shifts.map((shift) => {
                            const workDate = new Date(shift.work_date);
                            const isSundayShift = isSunday(workDate);
                            const isHolidayShift = isPublicHoliday(workDate);

                            return (
                                <motion.div
                                    key={shift.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                >
                                    <Card className={`shadow-md overflow-hidden rounded-2xl border-0 border-t-4 ${
                                        isSundayShift || isHolidayShift
                                            ? 'border-t-red-600 bg-red-50'
                                            : 'border-t-[#dc6b2f] bg-white'
                                    }`}>
                                        <CardContent className="bg-transparent p-5">
                                            <div className="flex items-start justify-between gap-4 mb-4">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => toggleCardExpansion(shift.id)}
                                                    className="text-slate-500 hover:text-slate-700 p-1"
                                                >
                                                    {expandedCards.has(shift.id) ? (
                                                        <ChevronUp className="w-4 h-4" />
                                                    ) : (
                                                        <ChevronDown className="w-4 h-4" />
                                                    )}
                                                </Button>

                                                <div className="flex gap-2">
                                                    <Badge variant={shift.has_left ? "default" : "secondary"}>
                                                        {shift.has_left ? (
                                                            <>
                                                                <CheckCircle className="w-3 h-3 mr-1" />
                                                                Completed
                                                            </>
                                                        ) : (
                                                            "In Progress"
                                                        )}
                                                    </Badge>
                                                    {isSundayShift && (
                                                        <Badge variant="destructive">Sunday</Badge>
                                                    )}
                                                    {isHolidayShift && (
                                                        <Badge variant="destructive">Holiday</Badge>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                <div className="flex items-start gap-4">
                                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                                                        shift.has_left ? 'bg-green-100' : 'bg-blue-100'
                                                    }`}>
                                                        <Clock className={`w-6 h-6 ${
                                                            shift.has_left ? 'text-green-600' : 'text-blue-600'
                                                        }`} />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                                                <Calendar className="w-3 h-3" />
                                                                {formatDate(shift.work_date)}
                                                            </span>
                                                            <span className="text-sm text-slate-500 flex items-center gap-1">
                                                                <MapPin className="w-3 h-3" />
                                                                {shift.sites?.site_name}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-4 text-sm">
                                                            {shift.entry_time && (
                                                                <span className="text-slate-600">
                                                                    Entry: {formatTime(shift.entry_time)}
                                                                </span>
                                                            )}
                                                            {shift.leave_time && (
                                                                <span className="text-slate-600">
                                                                    Leave: {formatTime(shift.leave_time)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {shift.has_left && (
                                                            <div className="flex items-center gap-4 text-sm flex-wrap">
                                                                <span className="text-green-600 font-medium">
                                                                    Worked: {shift.worked_hours?.toFixed(2)}h
                                                                </span>
                                                                {shift.sunday_hours > 0 && (
                                                                    <span className="text-orange-600 font-medium">
                                                                        Sunday: {shift.sunday_hours?.toFixed(2)}h
                                                                    </span>
                                                                )}
                                                                {shift.ot_hours > 0 && (
                                                                    <span className="text-blue-600 font-medium">
                                                                        OT: {shift.ot_hours?.toFixed(2)}h
                                                                    </span>
                                                                )}
                                                                {shift.breaks && shift.breaks.length > 0 && (
                                                                    <span className="text-purple-600 font-medium">
                                                                        Break: {calculateBreakHours(shift.breaks).toFixed(2)}h
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded Details */}
                                            {expandedCards.has(shift.id) && (
                                                <div className="mt-4 pt-4 border-t border-slate-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                                        <div>
                                                            <h4 className="font-medium text-slate-700 mb-2">Time Details</h4>
                                                            <div className="space-y-1">
                                                                <p>Entry: {shift.entry_time ? formatTime(shift.entry_time) : 'Not recorded'}</p>
                                                                {shift.breaks && shift.breaks.length > 0 && shift.breaks.map((breakRecord, index) => (
                                                                    <div key={breakRecord.id} className="flex items-center gap-1">
                                                                        <Coffee className="w-3 h-3" />
                                                                        Break {index + 1}: {formatTime(breakRecord.break_start)} - {formatTime(breakRecord.break_end)}
                                                                    </div>
                                                                ))}
                                                                <p>Leave: {shift.leave_time ? formatTime(shift.leave_time) : 'Not recorded'}</p>
                                                            </div>
                                                        </div>
                                                        {shift.has_left && (
                                                            <div>
                                                                <h4 className="font-medium text-slate-700 mb-2">Hours Breakdown</h4>
                                                                <div className="space-y-1">
                                                                    <p>Regular Hours: {shift.worked_hours?.toFixed(2) || 0}</p>
                                                                    <p>Sunday Hours: {shift.sunday_hours?.toFixed(2) || 0}</p>
                                                                    <p>OT Hours: {shift.ot_hours?.toFixed(2) || 0}</p>
                                                                    <p>Break Hours: {calculateBreakHours(shift.breaks).toFixed(2)}</p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-sm border-t border-slate-200 px-safe py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
                <p className="text-center text-slate-500 text-sm">
                    © {new Date().getFullYear()} AKK ENGINEERING PTE. LTD. — Time Sheet System
                </p>
            </footer>
        </div>
    );
}
