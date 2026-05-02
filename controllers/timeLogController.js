const TimeLog = require('../models/TimeLog');
const Project = require('../models/Project');

// Helper to calculate distance between two GPS points (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
};

// @desc    Clock In
// @route   POST /api/timelogs/clock-in
// @access  Private
const clockIn = async (req, res, next) => {
    try {
        const { projectId, jobId, taskId, latitude, longitude, accuracy, deviceInfo, userId, isManual, reason, clockIn: manualTime } = req.body;
        const targetUserId = userId || req.user._id;

        // Role-based check for manual entry
        if (isManual) {
            const allowedRoles = ['COMPANY_OWNER', 'PM', 'SUPER_ADMIN'];
            if (!allowedRoles.includes(req.user.role)) {
                res.status(403);
                throw new Error('Only Admin and Project Managers can perform manual time entry.');
            }
            if (!manualTime) {
                res.status(400);
                throw new Error('Clock-in time is required for manual entry.');
            }
        }

        // Validation: Mandatory GPS (Except for Admin Force Clock-in or Manual Entry)
        if (!isManual && ((!latitude && latitude !== 0) || (!longitude && longitude !== 0))) {
            if (!userId || userId === req.user._id.toString()) {
                res.status(400);
                throw new Error('Location access is required to clock in. Please enable GPS.');
            }
        }

        // Validation: Accuracy must be reasonable (e.g., < 200m)
        if (!isManual && accuracy && accuracy > 200) {
            if (!userId || userId === req.user._id.toString()) {
                res.status(400);
                throw new Error('GPS accuracy too low ( > 200m). Please try again in an area with better signal.');
            }
        }

        // Check if already clocked in
        const activeLog = await TimeLog.findOne({
            userId: targetUserId,
            clockOut: null
        });

        if (activeLog) {
            res.status(400);
            throw new Error('User already clocked in');
        }

        let geofenceStatus = 'unknown';
        let isOutsideGeofence = false;

        if (!isManual && projectId && latitude && longitude) {
            const project = await Project.findById(projectId);
            if (project) {
                // Use site coordinates if available, otherwise fallback to location.latitude
                const siteLat = project.siteLatitude || project.location?.latitude;
                const siteLon = project.siteLongitude || project.location?.longitude;
                const radius = project.allowedRadiusMeters || project.geofenceRadius || 100;

                if (siteLat && siteLon) {
                    const distance = calculateDistance(latitude, longitude, siteLat, siteLon);
                    isOutsideGeofence = distance > radius;
                    geofenceStatus = isOutsideGeofence ? 'outside' : 'inside';

                    // Block if strict geofence is enabled
                    if (isOutsideGeofence && project.strictGeofence) {
                        res.status(403);
                        throw new Error(`Clock-in blocked: You are ${Math.round(distance - radius)}m outside the allowed site radius.`);
                    }
                }
            }
        }

        const log = await TimeLog.create({
            companyId: req.user.companyId,
            userId: targetUserId,
            projectId,
            jobId,
            taskId,
            taskModel: req.body.taskType || 'JobTask',
            clockIn: isManual ? new Date(manualTime) : new Date(),
            gpsIn: { latitude, longitude }, // compatibility
            clockInLatitude: latitude,
            clockInLongitude: longitude,
            clockInAccuracy: accuracy,
            geofenceStatus,
            isOutsideGeofence,
            isManual: isManual || false,
            reason,
            createdBy: req.user._id,
            createdByRole: req.user.role,
            deviceInfo: isManual ? `Manual Entry by ${req.user.role}` : deviceInfo,
            clockOut: (isManual && req.body.clockOut) ? new Date(req.body.clockOut) : null
        });

        // If taskId is provided, update task status to 'in_progress'
        if (taskId) {
            const taskType = req.body.taskType || 'JobTask';
            let Model;
            let pendingStatus = 'pending';
            
            if (taskType === 'Task') {
                Model = require('../models/Task');
                pendingStatus = 'todo';
            } else if (taskType === 'SubTask') {
                Model = require('../models/SubTask');
                pendingStatus = 'todo';
            } else {
                Model = require('../models/JobTask');
                pendingStatus = 'pending';
            }

            try {
                await Model.findOneAndUpdate(
                    { _id: taskId, status: pendingStatus },
                    { $set: { status: 'in_progress' } }
                );
            } catch (err) {
                console.error(`Error updating assignment status for ${taskType}:`, err);
            }
        }

        // Auto-activate Job when worker clocks in
        if (jobId) {
            const Job = require('../models/Job');
            await Job.findOneAndUpdate(
                { _id: jobId, status: 'planning' },
                { $set: { status: 'active' } }
            );
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            const populatedLog = await TimeLog.findById(log._id)
                .populate('userId', 'fullName role avatar')
                .populate('projectId', 'name');

            io.emit('attendance_update', {
                type: log.clockOut ? 'manual-entry' : 'clock-in',
                userId: targetUserId,
                log: populatedLog
            });
            // Emit task update event to refresh UI without reload
            if (taskId) {
                io.emit('task_update', { taskId, status: 'in_progress' });
            }
        }

        res.status(201).json(log);
    } catch (error) {
        next(error);
    }
};

const clockOut = async (req, res, next) => {
    try {
        const { latitude, longitude, accuracy, userId, isManual, reason, clockOut: manualTime } = req.body;
        const targetUserId = userId || req.user._id;

        // Role-based check for manual entry
        if (isManual) {
            const allowedRoles = ['COMPANY_OWNER', 'PM', 'SUPER_ADMIN'];
            if (!allowedRoles.includes(req.user.role)) {
                res.status(403);
                throw new Error('Only Admin and Project Managers can perform manual time entry.');
            }
            if (!manualTime) {
                res.status(400);
                throw new Error('Clock-out time is required for manual entry.');
            }
        }

        // Validation: Mandatory GPS (Except for Admin/Foreman Force Clock-out or Manual Entry)
        if (!isManual && ((!latitude && latitude !== 0) || (!longitude && longitude !== 0))) {
            if (!userId || userId === req.user._id.toString()) {
                res.status(400);
                throw new Error('Location access is required to clock out. Please enable GPS.');
            }
        }

        const log = await TimeLog.findOne({
            userId: targetUserId,
            clockOut: null
        });

        if (!log) {
            res.status(400);
            throw new Error('User not clocked in');
        }

        // Potential geofence check for clock-out if required
        if (!isManual && log.projectId && latitude && longitude) {
            const project = await Project.findById(log.projectId);
            if (project) {
                const siteLat = project.siteLatitude || project.location?.latitude;
                const siteLon = project.siteLongitude || project.location?.longitude;
                const radius = project.allowedRadiusMeters || project.geofenceRadius || 100;

                if (siteLat && siteLon) {
                    const distance = calculateDistance(latitude, longitude, siteLat, siteLon);
                    // We update the flag if they clock out outside as well, or just record it
                    if (distance > radius) {
                        log.isOutsideGeofence = true;
                        log.geofenceStatus = 'outside';

                        if (project.strictGeofence) {
                            res.status(403);
                            throw new Error(`Clock-out blocked: You must be within the project site to clock out.`);
                        }
                    }
                }
            }
        }

        log.clockOut = isManual ? new Date(manualTime) : new Date();
        log.gpsOut = { latitude, longitude }; // compatibility
        log.clockOutLatitude = latitude;
        log.clockOutLongitude = longitude;
        log.clockOutAccuracy = accuracy;
        if (isManual) {
            log.isManual = true;
            log.reason = reason || log.reason;
            // Record who performed the manual action if it was changed during clock-out
            log.createdBy = req.user._id;
            log.createdByRole = req.user.role;
        }
        await log.save();

        // Auto-set Job to 'on-hold' when worker clocks out (only if it was active)
        if (log.jobId) {
            const Job = require('../models/Job');
            await Job.findOneAndUpdate(
                { _id: log.jobId, status: 'active' },
                { $set: { status: 'on-hold' } }
            );
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('attendance_update', {
                type: 'clock-out',
                userId: targetUserId,
                logId: log._id
            });
        }

        res.json(log);
    } catch (error) {
        next(error);
    }
};

// @desc    Get TimeLogs
// @route   GET /api/timelogs
// @access  Private
const getTimeLogs = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        if (req.query.userId) query.userId = req.query.userId;
        if (req.query.projectId) query.projectId = req.query.projectId;

        const logs = await TimeLog.find(query)
            .populate('userId', 'fullName email')
            .populate('projectId', 'name')
            .populate('jobId', 'name')
            .populate('taskId', 'title')
            .populate('createdBy', 'fullName role')
            .sort({ clockIn: -1 });

        res.json(logs);
    } catch (error) {
        next(error);
    }
};

// @desc    Update TimeLog (Approve/Reject)
// @route   PATCH /api/timelogs/:id
// @access  Private (PM, COMPANY_OWNER)
const updateTimeLog = async (req, res, next) => {
    try {
        const log = await TimeLog.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!log) {
            res.status(404);
            throw new Error('TimeLog not found');
        }

        const updatedLog = await TimeLog.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        }).populate('userId', 'fullName email').populate('projectId', 'name');

        res.json(updatedLog);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    clockIn,
    clockOut,
    getTimeLogs,
    updateTimeLog
};
