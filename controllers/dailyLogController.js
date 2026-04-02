const DailyLog = require('../models/DailyLog');

// @desc    Get all daily logs
// @route   GET /api/dailylogs
// @access  Private
const getDailyLogs = async (req, res, next) => {
    try {
        const query = { companyId: req.user.companyId };

        // Filter projects for clients
        if (req.user.role === 'CLIENT') {
            const Project = require('../models/Project');
            const clientProjects = await Project.find({ clientId: req.user._id }).select('_id');
            const projectIds = clientProjects.map(p => p._id);
            query.projectId = { $in: projectIds };
        }

        if (req.query.projectId) {
            // If projectId is provided, ensure it's one of the client's projects
            if (req.user.role === 'CLIENT' && !query.projectId.$in.some(id => id.toString() === req.query.projectId)) {
                return res.status(403).json({ message: 'Not authorized to access this project logs' });
            }
            query.projectId = req.query.projectId;
        }
        if (req.query.date) query.date = req.query.date;

        const logs = await DailyLog.find(query)
            .populate('projectId', 'name')
            .populate('reportedBy', 'fullName role')
            .sort({ date: -1 });

        res.json(logs);
    } catch (error) {
        next(error);
    }
};

// @desc    Create daily log
// @route   POST /api/dailylogs
// @access  Private (Foreman, PM)
const createDailyLog = async (req, res, next) => {
    try {
        let photos = [];
        if (req.files && req.files.length > 0) {
            photos = req.files.map(file => file.path || file.secure_url);
        }

        const logData = {
            ...req.body,
            photos,
            companyId: req.user.companyId,
            reportedBy: req.user._id
        };

        // Handle fields that might be stringified JSON from multipart/form-data
        const jsonFields = ['location', 'manpower', 'weather', 'materialsReceived', 'equipmentUsed', 'visitors'];
        jsonFields.forEach(field => {
            if (typeof req.body[field] === 'string') {
                try {
                    logData[field] = JSON.parse(req.body[field]);
                } catch (e) {
                    console.error(`Error parsing ${field}:`, e);
                }
            }
        });

        const log = await DailyLog.create(logData);
        res.status(201).json(log);
    } catch (error) {
        next(error);
    }
};

// @desc    Verify daily log
// @route   POST /api/dailylogs/:id/verify
// @access  Private (PM, Owners)
const verifyDailyLog = async (req, res, next) => {
    try {
        const log = await DailyLog.findOne({ _id: req.params.id, companyId: req.user.companyId });

        if (!log) {
            res.status(404);
            throw new Error('Daily log not found');
        }

        log.isVerified = true;
        log.verifiedBy = req.user._id;
        await log.save();

        res.json(log);
    } catch (error) {
        next(error);
    }
};

const deleteDailyLog = async (req, res, next) => {
    try {
        const log = await DailyLog.findOneAndDelete({ _id: req.params.id, companyId: req.user.companyId });
        if (!log) {
            res.status(404);
            throw new Error('Daily log not found');
        }
        res.json({ message: 'Daily log removed' });
    } catch (error) {
        next(error);
    }
};

const updateDailyLog = async (req, res, next) => {
    try {
        const log = await DailyLog.findOne({ _id: req.params.id, companyId: req.user.companyId });
        if (!log) {
            res.status(404);
            throw new Error('Daily log not found');
        }

        let photos = log.photos || [];
        if (req.files && req.files.length > 0) {
            const newPhotos = req.files.map(file => file.path || file.secure_url);
            photos = [...photos, ...newPhotos];
        }

        const updateData = {
            ...req.body,
            photos
        };

        // Handle fields that might be stringified JSON from multipart/form-data
        const jsonFields = ['location', 'manpower', 'weather', 'materialsReceived', 'equipmentUsed', 'visitors'];
        jsonFields.forEach(field => {
            if (typeof req.body[field] === 'string') {
                try {
                    updateData[field] = JSON.parse(req.body[field]);
                } catch (e) {
                    console.error(`Error parsing ${field}:`, e);
                }
            }
        });

        const updatedLog = await DailyLog.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        }).populate('projectId', 'name').populate('reportedBy', 'fullName role');

        res.json(updatedLog);
    } catch (error) {
        next(error);
    }
};

// @desc    Get daily log reports (Summary + Charts)
// @route   GET /api/dailylogs/reports
// @access  Private (Admin, PM)
const getDailyLogReports = async (req, res, next) => {
    try {
        const { projectId, from, to } = req.query;
        const query = { companyId: req.user.companyId };

        // Role-based visibility
        if (req.user.role === 'PM') {
            const Project = require('../models/Project');
            const pmProjects = await Project.find({
                $or: [
                    { pmId: req.user._id },
                    { createdBy: req.user._id }
                ]
            }).select('_id');
            const projectIds = pmProjects.map(p => p._id);

            if (projectId) {
                if (!projectIds.some(id => id.toString() === projectId)) {
                    return res.status(403).json({ message: 'Not authorized for this project' });
                }
                query.projectId = projectId;
            } else {
                query.projectId = { $in: projectIds };
            }
        } else if (projectId) {
            query.projectId = projectId;
        }

        if (from || to) {
            query.date = {};
            if (from) query.date.$gte = new Date(from);
            if (to) query.date.$lte = new Date(to);
        }

        const logs = await DailyLog.find(query).sort({ date: 1 });

        // Summary Statistics
        const totalLogs = logs.length;
        const distinctDays = new Set(logs.map(l => l.date.toISOString().split('T')[0])).size;

        let totalManpower = 0;
        logs.forEach(log => {
            log.manpower.forEach(m => (totalManpower += m.count || 0));
        });

        // Charts Data
        // 1. Manpower Trend
        const manpowerTrend = logs.reduce((acc, log) => {
            const dateStr = log.date.toISOString().split('T')[0];
            const dayCount = log.manpower.reduce((sum, m) => sum + (m.count || 0), 0);
            const existing = acc.find(a => a.date === dateStr);
            if (existing) existing.count += dayCount;
            else acc.push({ date: dateStr, count: dayCount });
            return acc;
        }, []);

        // 2. Weather Distribution
        const weatherDist = logs.reduce((acc, log) => {
            const status = log.weather?.status || 'Unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        const weatherChart = Object.keys(weatherDist).map(k => ({ name: k, value: weatherDist[k] }));

        // 3. Activity Frequency - dynamic word frequency from actual work performed text
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'that', 'these', 'this', 'those', 'up', 'also', 'as', 'it']);
        const wordFreq = {};
        logs.forEach(log => {
            if (!log.workPerformed) return;
            const words = log.workPerformed
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.has(w));
            words.forEach(w => {
                wordFreq[w] = (wordFreq[w] || 0) + 1;
            });
        });
        const activityChart = Object.entries(wordFreq)
            .map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // top 10 most frequent terms

        res.json({
            summary: {
                totalLogs,
                distinctDays,
                totalManpower,
                avgWorkers: distinctDays > 0 ? (totalManpower / distinctDays).toFixed(1) : 0
            },
            charts: {
                manpowerTrend,
                weatherChart,
                activityChart
            },
            logs: logs.map(l => ({
                date: l.date,
                weather: l.weather,
                workPerformed: l.workPerformed,
                manpower: l.manpower
            }))
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDailyLogs,
    createDailyLog,
    verifyDailyLog,
    updateDailyLog,
    deleteDailyLog,
    getDailyLogReports
};
