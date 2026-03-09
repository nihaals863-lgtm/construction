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
        const { projectId, jobId, taskId, latitude, longitude, accuracy, deviceInfo, userId } = req.body;
        const targetUserId = userId || req.user._id;

        // Validation: Mandatory GPS
        if (!latitude || !longitude) {
            res.status(400);
            throw new Error('Location access is required to clock in. Please enable GPS.');
        }

        // Validation: Accuracy must be reasonable (e.g., < 50m)
        if (accuracy && accuracy > 50) {
            res.status(400);
            throw new Error('GPS accuracy too low ( > 50m). Please try again in an area with better signal.');
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

        if (projectId && latitude && longitude) {
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
            clockIn: new Date(),
            gpsIn: { latitude, longitude }, // compatibility
            clockInLatitude: latitude,
            clockInLongitude: longitude,
            clockInAccuracy: accuracy,
            geofenceStatus,
            isOutsideGeofence,
            deviceInfo
        });

        // If taskId is provided, update task status to 'in_progress'
        if (taskId) {
            const JobTask = require('../models/JobTask');
            await JobTask.findOneAndUpdate(
                { _id: taskId, status: 'pending' },
                { $set: { status: 'in_progress' } }
            );
        }

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('attendance_update', {
                type: 'clock-in',
                userId: targetUserId,
                log: await TimeLog.findById(log._id).populate('userId', 'fullName role avatar').populate('projectId', 'name')
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
        const { latitude, longitude, accuracy, userId } = req.body;
        const targetUserId = userId || req.user._id;

        // Validation: Mandatory GPS
        if (!latitude || !longitude) {
            res.status(400);
            throw new Error('Location access is required to clock out. Please enable GPS.');
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
        if (log.projectId && latitude && longitude) {
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

        log.clockOut = new Date();
        log.gpsOut = { latitude, longitude }; // compatibility
        log.clockOutLatitude = latitude;
        log.clockOutLongitude = longitude;
        log.clockOutAccuracy = accuracy;
        await log.save();

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
