const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const TimeLog = require('../models/TimeLog');
const Invoice = require('../models/Invoice');
const Issue = require('../models/Issue');
const User = require('../models/User');
const PurchaseOrder = require('../models/purchaseOrder.model');
const DailyLog = require('../models/DailyLog');
const Equipment = require('../models/Equipment');
const RFI = require('../models/RFI');
const Job = require('../models/Job');
const JobTask = require('../models/JobTask');
const SubTask = require('../models/SubTask');
const JobNote = require('../models/JobNote');

// @desc    Get project overview report
// @route   GET /api/reports/project/:projectId
// @access  Private (PM, Owners)
const getProjectReport = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const companyId = req.user.companyId;

        const project = await Project.findOne({ _id: projectId, companyId });
        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        const totalTasks = await Task.countDocuments({ projectId });
        const completedTasks = await Task.countDocuments({ projectId, status: 'completed' });

        const timeLogs = await TimeLog.find({ projectId });
        const totalHours = timeLogs.reduce((acc, log) => {
            if (log.clockOut) {
                return acc + (new Date(log.clockOut) - new Date(log.clockIn)) / (1000 * 60 * 60);
            }
            return acc;
        }, 0);

        const invoices = await Invoice.find({ projectId });
        const totalInvoiced = invoices.reduce((acc, inv) => acc + inv.totalAmount, 0);
        const totalPaid = invoices.filter(inv => inv.status === 'paid').reduce((acc, inv) => acc + inv.totalAmount, 0);

        res.json({
            project: {
                name: project.name,
                status: project.status,
                progress: project.progress,
                budget: project.budget
            },
            tasks: {
                total: totalTasks,
                completed: completedTasks,
                completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0
            },
            labor: {
                totalHours: totalHours.toFixed(2)
            },
            financials: {
                totalInvoiced,
                totalPaid,
                outstanding: totalInvoiced - totalPaid
            }
        });
    } catch (error) {
        next(error);
    }
};



// @desc    Get company-wide report
// @route   GET /api/reports/company
// @access  Private (Owners, Admins)
const getCompanyReport = async (req, res, next) => {
    try {
        const companyId = req.user.companyId;

        // Financials
        const invoices = await Invoice.find({ companyId });
        const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.totalAmount || 0), 0);
        const totalPaid = invoices.filter(inv => inv.status === 'paid').reduce((acc, inv) => acc + (inv.totalAmount || 0), 0);
        const totalOutstanding = totalInvoiced - totalPaid;

        // Projects
        const totalProjects = await Project.countDocuments({ companyId });
        const preConstruction = await Project.countDocuments({ companyId, status: 'planning' });
        const activeSites = await Project.countDocuments({ companyId, status: 'active' });
        const onHold = await Project.countDocuments({ companyId, status: 'on_hold' });
        const handedOver = await Project.countDocuments({ companyId, status: 'completed' });

        // Jobs
        const totalJobs = await Job.countDocuments({ companyId });
        const completedJobs = await Job.countDocuments({ companyId, status: 'completed' });

        // Labor Hours (from TimeLogs)
        const timeLogs = await TimeLog.find({ companyId });
        const totalLaborHours = timeLogs.reduce((acc, log) => {
            if (log.clockOut && log.clockIn) {
                const hours = (new Date(log.clockOut) - new Date(log.clockIn)) / (1000 * 60 * 60);
                return acc + hours;
            }
            return acc;
        }, 0);

        // Tasks counts
        const totalTasksCount = await Task.countDocuments({ companyId });
        const completedTasksCount = await Task.countDocuments({ companyId, status: 'completed' });
        const overdueTasksCount = await Task.countDocuments({ 
            companyId, 
            status: { $ne: 'completed' }, 
            dueDate: { $lt: new Date() } 
        });

        // Weekly Productivity (Last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentLogs = await TimeLog.find({
            companyId,
            createdAt: { $gte: sevenDaysAgo }
        });

        // Group by day
        const dailyProductivity = {};
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        // Initialize last 7 days
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dayName = days[d.getDay()];
            dailyProductivity[dayName] = 0;
        }

        recentLogs.forEach(log => {
            if (log.clockOut && log.clockIn) {
                const d = new Date(log.clockIn);
                const dayName = days[d.getDay()];
                const hours = (new Date(log.clockOut) - new Date(log.clockIn)) / (1000 * 60 * 60);
                if (dailyProductivity[dayName] !== undefined) {
                    dailyProductivity[dayName] += hours;
                }
            }
        });

        const productivityData = Object.keys(dailyProductivity).map(day => ({
            day,
            hours: Math.round(dailyProductivity[day] * 10) / 10
        }));

        // Calculate Total Project Budget
        const projects = await Project.find({ companyId });
        const totalBudget = projects.reduce((acc, proj) => acc + (proj.budget || 0), 0);

        // Safety Incidents (Issues with category 'safety')
        const safetyIncidentsCount = await Issue.countDocuments({ companyId, category: 'safety' });

        // Days Incident Free
        const lastSafetyIncident = await Issue.findOne({ companyId, category: 'safety' })
            .sort({ createdAt: -1 });

        let daysIncidentFree = 0;
        if (lastSafetyIncident) {
            const today = new Date();
            const lastDate = new Date(lastSafetyIncident.createdAt);
            const diffTime = Math.abs(today - lastDate);
            daysIncidentFree = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        } else {
            // If no incidents, technically incident free since company start match report logic or just 0?
            // Let's use 0 or maybe a high number if we want to show positive metric? 
            // For now, let's just make it 0 if no incidents ever, or maybe the company creation date?
            // Let's go with 0 to keep it simple, or maybe "N/A"
            daysIncidentFree = 0;
        }


        // Equipment Stats
        const totalEquipment = await Equipment.countDocuments({ companyId });
        const operationalEquipment = await Equipment.countDocuments({ companyId, status: 'operational' });

        // Detailed Overdue Tasks
        const outstandingTasksList = await Task.find({
            companyId,
            status: { $ne: 'completed' },
            dueDate: { $lt: new Date() }
        })
        .sort({ dueDate: 1 })
        .limit(10)
        .populate('projectId', 'name');

        res.json({
            financials: {
                totalRevenue: totalPaid,
                totalInvoiced,
                outstanding: totalOutstanding,
                projectBudget: totalBudget
            },
            projects: {
                total: totalProjects,
                preConstruction,
                activeSites,
                onHold,
                handedOver
            },
            tasks: {
                total: totalTasksCount,
                completed: completedTasksCount,
                overdue: overdueTasksCount,
                completionRate: totalTasksCount > 0 ? ((completedTasksCount / totalTasksCount) * 100).toFixed(1) : 0,
                outstandingTasks: outstandingTasksList.map(t => ({
                    title: t.title,
                    dueDate: t.dueDate,
                    projectName: t.projectId?.name || 'Unknown Project'
                }))
            },
            labor: {
                totalHours: Math.round(totalLaborHours),
                productivityData
            },
            safety: {
                totalIncidents: safetyIncidentsCount,
                daysIncidentFree
            },
            equipment: {
                total: totalEquipment,
                operational: operationalEquipment
            },
            jobs: {
                total: totalJobs,
                completed: completedJobs
            }
        });

    } catch (error) {
        next(error);
    }
};
const getDashboardStats = async (req, res, next) => {
    try {
        const companyId = req.user.companyId;
        const userId = req.user._id;
        const role = req.user.role;

        const stats = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(today.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        if (['COMPANY_OWNER', 'PM', 'FOREMAN', 'SUBCONTRACTOR'].includes(role)) {
            // Define filters
            const projectFilter = { companyId, status: { $in: ['active', 'planning'] } };
            const jobFilter = { companyId };
            const timeLogFilter = { companyId };
            const poFilter = { companyId, status: { $in: ['Draft', 'Pending Approval', 'Approved', 'Sent', 'Delivered'] } };
            const pendingPOFilter = { companyId, status: 'Pending Approval' };
            const dailyLogFilter = { companyId };

            if (role === 'PM') {
                const directProjects = await Project.find({
                    companyId,
                    $or: [{ pmId: userId }, { createdBy: userId }]
                }).select('_id');

                const jobProjects = await Job.find({
                    $or: [{ foremanId: userId }, { createdBy: userId }]
                }).select('projectId');

                const allProjectIds = [...new Set([
                    ...directProjects.map(p => p._id.toString()),
                    ...jobProjects.filter(j => j.projectId).map(j => j.projectId.toString())
                ])];

                projectFilter._id = { $in: allProjectIds };
                projectFilter.status = { $in: ['active', 'planning'] };
                jobFilter.$or = [{ projectId: { $in: allProjectIds } }, { createdBy: userId }, { foremanId: userId }];
                timeLogFilter.projectId = { $in: allProjectIds };
                poFilter.projectId = { $in: allProjectIds };
                dailyLogFilter.projectId = { $in: allProjectIds };
            }

            // Fetch Multi-metrics
            const [
                activeJobsCount,
                crewOnSiteCount,
                totalCrew,
                pos,
                pendingPOsCount,
                pendingLogs,
                recentActivity,
                recentLogs,
                equipAlerts,
                overdueRFIs,
                overdueTasks,
                offlineSyncs
            ] = await Promise.all([
                Project.countDocuments(projectFilter),
                TimeLog.countDocuments({ ...timeLogFilter, clockOut: null }),
                User.countDocuments({ companyId, role: { $in: ['WORKER', 'FOREMAN', 'PM'] } }),
                PurchaseOrder.find(poFilter),
                PurchaseOrder.countDocuments(pendingPOFilter),
                TimeLog.countDocuments({ ...timeLogFilter, status: 'pending' }),
                TimeLog.find(timeLogFilter).sort({ clockIn: -1 }).limit(5).populate('userId', 'fullName avatar').populate('projectId', 'name'),
                DailyLog.find(dailyLogFilter).sort({ date: -1 }).limit(3).populate('reportedBy', 'fullName').populate('projectId', 'name'),
                Equipment.find({ companyId }).populate('assignedJob', 'status'),
                RFI.countDocuments({ companyId, status: { $ne: 'closed' }, dueDate: { $lt: new Date() } }),
                Task.countDocuments({ companyId, status: { $ne: 'completed' }, dueDate: { $lt: new Date() } }),
                TimeLog.countDocuments({ companyId, offlineSync: true, status: 'pending' })
            ]);

            const equipAlertCount = equipAlerts.filter(e => e.assignedJob?.status === 'completed').length;

            // Calculate hours today
            const logsToday = await TimeLog.find({ ...timeLogFilter, clockIn: { $gte: today } });
            const hoursToday = logsToday.reduce((acc, log) => {
                const end = log.clockOut || new Date();
                return acc + (end - new Date(log.clockIn)) / (1000 * 60 * 60);
            }, 0);

            stats.metrics = {
                activeJobs: activeJobsCount,
                crewOnSiteCount,
                totalCrew,
                hoursToday: Math.round(hoursToday),
                equipmentRunning: equipAlerts.filter(e => e.status === 'operational').length,
                openPos: pos.length,
                openPosValue: pos.reduce((acc, p) => acc + (p.totalAmount || 0), 0),
                pendingApprovals: pendingLogs + pendingPOsCount,
                equipmentAlerts: equipAlertCount,
                overdueRFIs,
                overdueTasks,
                offlineSyncs
            };

            stats.crewActivity = recentActivity.map(log => ({
                name: log.userId?.fullName || 'Unknown',
                job: log.projectId?.name || 'No Project',
                time: new Date(log.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: log.clockOut ? 'Clocked Out' : 'On Site',
                subtext: log.clockOut ? `${Math.round((new Date(log.clockOut) - new Date(log.clockIn)) / (1000 * 60 * 60))}h total` : null,
                avatar: log.userId?.fullName?.split(' ').map(n => n[0]).join('') || '??',
                lat: log.gpsIn?.latitude || null,
                lng: log.gpsIn?.longitude || null
            }));

            stats.recentDailyLogs = recentLogs.map(log => ({
                job: log.projectId?.name || '---',
                date: new Date(log.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
                foreman: log.reportedBy?.fullName || '---'
            }));
        }

        if (['WORKER', 'SUBCONTRACTOR', 'FOREMAN'].includes(role)) {
            const myLogsToday = await TimeLog.find({ userId, clockIn: { $gte: today } });
            const myHoursToday = myLogsToday.reduce((acc, log) => {
                const end = log.clockOut || new Date();
                return acc + (end - new Date(log.clockIn)) / (1000 * 60 * 60);
            }, 0);

            const activeLog = await TimeLog.findOne({ userId, clockOut: null }).populate('projectId', 'name');

            // Weekly hours
            const startOfWeek = new Date();
            startOfWeek.setDate(today.getDate() - today.getDay());
            const myWeeklyLogs = await TimeLog.find({ userId, clockIn: { $gte: startOfWeek } });
            const totalWeeklyHours = myWeeklyLogs.reduce((acc, log) => {
                const end = log.clockOut || new Date();
                return acc + (end - new Date(log.clockIn)) / (1000 * 60 * 60);
            }, 0);

            // Fetch assigned projects for the selection dropdown
            const jobs = await Job.find({
                companyId,
                $or: [
                    { assignedWorkers: userId },
                    { foremanId: userId }
                ]
            }).populate('projectId', 'name');

            const assignedProjects = jobs
                .filter(j => j.projectId)
                .map(j => ({
                    _id: j.projectId._id,
                    name: j.projectId.name,
                    jobName: j.name,
                    jobId: j._id
                }));

            const JobTask = require('../models/JobTask');
            const userJobTasks = await JobTask.find({
                companyId,
                $or: [{ assignedTo: userId }, { assignedForeman: userId }],
                status: { $nin: ['completed', 'cancelled'] }
            }).populate({
                path: 'jobId',
                select: 'name projectId',
                populate: { path: 'projectId', select: 'name' }
            });

            const assignedTasks = userJobTasks.map(t => ({
                _id: t._id,
                title: t.title,
                jobName: t.jobId?.name || 'Unknown Job',
                projectName: t.jobId?.projectId?.name || 'Unknown Project',
                jobId: t.jobId?._id,
                projectId: t.jobId?.projectId?._id
            }));

            stats.workerMetrics = {
                myHoursToday: myHoursToday.toFixed(1) + 'h',
                currentJob: activeLog?.taskId?.title || activeLog?.projectId?.name || 'Not Clocked In',
                weeklyTarget: '40h',
                weeklyDone: Math.round(totalWeeklyHours) + 'h done',
                isClockedIn: !!activeLog,
                timer: activeLog ? Math.floor((new Date() - new Date(activeLog.clockIn)) / 1000) : 0,
                assignedProjects: assignedProjects,
                assignedTasks: assignedTasks
            };

            const myRecentActivity = await TimeLog.find({ userId })
                .sort({ clockIn: -1 })
                .limit(5)
                .populate('projectId', 'name')
                .populate('taskId', 'title');

            stats.myRecentActivity = myRecentActivity.map(log => ({
                id: log._id,
                action: log.clockOut ? 'Clocked Out' : 'Clocked In',
                job: log.projectId?.name || '---',
                time: new Date(log.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                date: new Date(log.clockIn).toDateString() === new Date().toDateString() ? 'Today' :
                    new Date(log.clockIn).toDateString() === new Date(Date.now() - 86400000).toDateString() ? 'Yesterday' :
                        new Date(log.clockIn).toLocaleDateString()
            }));
        }

        // Productivity Trend (Last 7 Days)
        const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const productivity = [];
        const projectProductivity = {}; // To find Top Project

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const startOfDay = new Date(d); startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(d); endOfDay.setHours(23, 59, 59, 999);

            const logs = await TimeLog.find({ companyId, clockIn: { $gte: startOfDay, $lte: endOfDay } });
            const totalHours = logs.reduce((acc, log) => {
                const end = log.clockOut || (new Date().toDateString() === d.toDateString() ? new Date() : endOfDay);
                const h = Math.max(0, (end - new Date(log.clockIn)) / (1000 * 60 * 60));

                // Track project productivity for top project identification
                if (log.projectId) {
                    const pid = log.projectId.toString();
                    projectProductivity[pid] = (projectProductivity[pid] || 0) + h;
                }

                return acc + h;
            }, 0);

            productivity.push({ day: daysShort[d.getDay()], hours: Math.round(totalHours), date: startOfDay });
        }
        stats.trendData = productivity;

        // Find Top Project for the localized "Hours Trend" section
        const topProjectId = Object.keys(projectProductivity).sort((a, b) => projectProductivity[b] - projectProductivity[a])[0];
        if (topProjectId) {
            const topProj = await Project.findById(topProjectId).populate('pmId', 'fullName');
            if (topProj) {
                stats.topProject = {
                    name: topProj.name,
                    manager: topProj.pmId?.fullName || 'Unassigned',
                    hours: Math.round(projectProductivity[topProjectId]),
                    image: topProj.image || 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=200'
                };
            }
        }

        res.json(stats);
    } catch (error) {
        next(error);
    }
};

// @desc    Get worker-specific attendance reports
// @route   GET /api/reports/attendance/workers
// @access  Private (Admin, PM)
const getWorkerAttendanceReport = async (req, res, next) => {
    try {
        const { startDate, endDate, projectId, userId } = req.query;
        const companyId = req.user.companyId;

        const match = { companyId: new mongoose.Types.ObjectId(companyId) };

        if (startDate || endDate) {
            match.clockIn = {};
            if (startDate) match.clockIn.$gte = new Date(startDate);
            if (endDate) match.clockIn.$lte = new Date(endDate);
        }

        if (projectId) match.projectId = new mongoose.Types.ObjectId(projectId);
        if (userId) match.userId = new mongoose.Types.ObjectId(userId);

        const aggregation = [
            { $match: match },
            {
                $addFields: {
                    duration: {
                        $cond: [
                            { $and: ["$clockIn", "$clockOut"] },
                            { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 3600000] },
                            0
                        ]
                    },
                    workDay: { $dateToString: { format: "%Y-%m-%d", date: "$clockIn" } }
                }
            },
            {
                $group: {
                    _id: { userId: "$userId", projectId: "$projectId" },
                    totalHours: { $sum: "$duration" },
                    daysWorked: { $addToSet: "$workDay" },
                    totalEntries: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: "$_id.userId",
                    projects: {
                        $push: {
                            projectId: "$_id.projectId",
                            totalHours: "$totalHours"
                        }
                    },
                    overallHours: { $sum: "$totalHours" },
                    allDaysWorked: { $push: "$daysWorked" }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    fullName: '$user.fullName',
                    email: '$user.email',
                    role: '$user.role',
                    totalHours: { $round: ["$overallHours", 2] },
                    totalDaysWorked: {
                        $size: {
                            $reduce: {
                                input: "$allDaysWorked",
                                initialValue: [],
                                in: { $setUnion: ["$$value", "$$this"] }
                            }
                        }
                    },
                    averageHoursPerDay: {
                        $cond: [
                            { $gt: [{ $size: { $reduce: { input: "$allDaysWorked", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } }, 0] },
                            { $round: [{ $divide: ["$overallHours", { $size: { $reduce: { input: "$allDaysWorked", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } }] }, 2] },
                            0
                        ]
                    }
                }
            },
            { $sort: { fullName: 1 } }
        ];

        const report = await TimeLog.aggregate(aggregation);
        res.json(report);
    } catch (error) {
        next(error);
    }
};

// @desc    Get foreman-specific attendance reports
// @route   GET /api/reports/attendance/foremen
// @access  Private (Admin, PM)
const getForemanAttendanceReport = async (req, res, next) => {
    try {
        const { startDate, endDate, projectId, userId } = req.query;
        const companyId = req.user.companyId;

        // First find foremen in the company
        const foremen = await User.find({ companyId, role: 'FOREMAN' }).select('_id');
        const foremanIds = foremen.map(f => f._id);

        const match = {
            companyId: new mongoose.Types.ObjectId(companyId),
            userId: { $in: foremanIds }
        };

        if (startDate || endDate) {
            match.clockIn = {};
            if (startDate) match.clockIn.$gte = new Date(startDate);
            if (endDate) match.clockIn.$lte = new Date(endDate);
        }

        if (projectId) match.projectId = new mongoose.Types.ObjectId(projectId);
        if (userId) {
            const requestedUserId = new mongoose.Types.ObjectId(userId);
            if (foremanIds.some(id => id.equals(requestedUserId))) {
                match.userId = requestedUserId;
            } else {
                return res.json([]); // Not a foreman
            }
        }

        const aggregation = [
            { $match: match },
            {
                $addFields: {
                    duration: {
                        $cond: [
                            { $and: ["$clockIn", "$clockOut"] },
                            { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 3600000] },
                            0
                        ]
                    },
                    workDay: { $dateToString: { format: "%Y-%m-%d", date: "$clockIn" } }
                }
            },
            {
                $group: {
                    _id: { userId: "$userId", projectId: "$projectId" },
                    totalHours: { $sum: "$duration" },
                    daysWorked: { $addToSet: "$workDay" },
                    totalEntries: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: "$_id.userId",
                    overallHours: { $sum: "$totalHours" },
                    allDaysWorked: { $push: "$daysWorked" }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    fullName: '$user.fullName',
                    email: '$user.email',
                    role: '$user.role',
                    totalHours: { $round: ["$overallHours", 2] },
                    totalDaysWorked: {
                        $size: {
                            $reduce: {
                                input: "$allDaysWorked",
                                initialValue: [],
                                in: { $setUnion: ["$$value", "$$this"] }
                            }
                        }
                    },
                    averageHoursPerDay: {
                        $cond: [
                            { $gt: [{ $size: { $reduce: { input: "$allDaysWorked", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } }, 0] },
                            { $round: [{ $divide: ["$overallHours", { $size: { $reduce: { input: "$allDaysWorked", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } }] }, 2] },
                            0
                        ]
                    }
                }
            },
            { $sort: { fullName: 1 } }
        ];

        const report = await TimeLog.aggregate(aggregation);
        res.json(report);
    } catch (error) {
        next(error);
    }
};

// @desc    Get project-level attendance summary
// @route   GET /api/reports/attendance/projects
// @access  Private (Admin, PM)
const getProjectAttendanceReport = async (req, res, next) => {
    try {
        const { startDate, endDate, projectId } = req.query;
        const companyId = req.user.companyId;

        const match = { companyId: new mongoose.Types.ObjectId(companyId) };

        if (startDate || endDate) {
            match.clockIn = {};
            if (startDate) match.clockIn.$gte = new Date(startDate);
            if (endDate) match.clockIn.$lte = new Date(endDate);
        }

        if (projectId) match.projectId = new mongoose.Types.ObjectId(projectId);

        const aggregation = [
            { $match: match },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $addFields: {
                    duration: {
                        $cond: [
                            { $and: ["$clockIn", "$clockOut"] },
                            { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 3600000] },
                            0
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: "$projectId",
                    totalHours: { $sum: "$duration" },
                    totalEntries: { $sum: 1 },
                    workerHours: {
                        $sum: { $cond: [{ $eq: ["$user.role", "WORKER"] }, "$duration", 0] }
                    },
                    foremanHours: {
                        $sum: { $cond: [{ $eq: ["$user.role", "FOREMAN"] }, "$duration", 0] }
                    }
                }
            },
            {
                $lookup: {
                    from: 'projects',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'project'
                }
            },
            { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    projectName: { $ifNull: ["$project.name", "Manual Entries"] },
                    totalHours: { $round: ["$totalHours", 2] },
                    workerHours: { $round: ["$workerHours", 2] },
                    foremanHours: { $round: ["$foremanHours", 2] },
                    totalAttendanceEntries: "$totalEntries"
                }
            },
            { $sort: { projectName: 1 } }
        ];

        const report = await TimeLog.aggregate(aggregation);
        res.json(report);
    } catch (error) {
        next(error);
    }
};

// @desc    Export attendance report (PDF/CSV)
// @route   GET /api/reports/attendance/export
// @access  Private (Admin, PM)
const exportAttendanceReport = async (req, res, next) => {
    try {
        const { type, reportType, startDate, endDate, projectId } = req.query;
        const companyId = req.user.companyId;
        const PDFDocument = require('pdfkit');

        // Fetch data based on reportType
        let data = [];
        const match = { companyId: new mongoose.Types.ObjectId(companyId) };
        if (startDate || endDate) {
            match.clockIn = {};
            if (startDate) match.clockIn.$gte = new Date(startDate);
            if (endDate) match.clockIn.$lte = new Date(endDate);
        }
        if (projectId) match.projectId = new mongoose.Types.ObjectId(projectId);

        if (reportType === 'workers' || reportType === 'foremen') {
            const foremen = await User.find({ companyId, role: 'FOREMAN' }).select('_id');
            const foremanIds = foremen.map(f => f._id);
            if (reportType === 'foremen') {
                match.userId = { $in: foremanIds };
            }

            data = await TimeLog.aggregate([
                { $match: match },
                {
                    $addFields: {
                        duration: {
                            $cond: [
                                { $and: ["$clockIn", "$clockOut"] },
                                { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 3600000] },
                                0
                            ]
                        },
                        workDay: { $dateToString: { format: "%Y-%m-%d", date: "$clockIn" } }
                    }
                },
                {
                    $group: {
                        _id: "$userId",
                        totalHours: { $sum: "$duration" },
                        daysWorked: { $addToSet: "$workDay" }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                {
                    $project: {
                        fullName: '$user.fullName',
                        role: '$user.role',
                        totalHours: { $round: ["$totalHours", 2] },
                        totalDaysWorked: { $size: "$daysWorked" }
                    }
                },
                { $sort: { fullName: 1 } }
            ]);
        } else {
            data = await TimeLog.aggregate([
                { $match: match },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                {
                    $addFields: {
                        duration: {
                            $cond: [
                                { $and: ["$clockIn", "$clockOut"] },
                                { $divide: [{ $subtract: ["$clockOut", "$clockIn"] }, 3600000] },
                                0
                            ]
                        }
                    }
                },
                {
                    $group: {
                        _id: "$projectId",
                        totalHours: { $sum: "$duration" },
                        workerHours: { $sum: { $cond: [{ $eq: ["$user.role", "WORKER"] }, "$duration", 0] } },
                        foremanHours: { $sum: { $cond: [{ $eq: ["$user.role", "FOREMAN"] }, "$duration", 0] } },
                        totalEntries: { $sum: 1 }
                    }
                },
                {
                    $lookup: {
                        from: 'projects',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'project'
                    }
                },
                { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        projectName: { $ifNull: ["$project.name", "Manual Entries"] },
                        totalHours: { $round: ["$totalHours", 2] },
                        workerHours: { $round: ["$workerHours", 2] },
                        foremanHours: { $round: ["$foremanHours", 2] },
                        totalAttendanceEntries: "$totalEntries"
                    }
                },
                { $sort: { projectName: 1 } }
            ]);
        }

        if (type === 'excel') {
            let csv = '';
            if (reportType === 'workers' || reportType === 'foremen') {
                csv = 'Name,Role,Total Hours,Days Worked\n' +
                    data.map(r => `"${r.fullName}","${r.role}",${r.totalHours},${r.totalDaysWorked}`).join('\n');
            } else {
                csv = 'Project Name,Worker Hours,Foreman Hours,Grand Total Hours,Total Entries\n' +
                    data.map(r => `"${r.projectName}",${r.workerHours},${r.foremanHours},${r.totalHours},${r.totalAttendanceEntries}`).join('\n');
            }
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=Attendance_Report_${reportType}.csv`);
            return res.status(200).send(csv);
        }

        if (type === 'pdf') {
            const doc = new PDFDocument();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Attendance_Report_${reportType}.pdf`);
            doc.pipe(res);

            // Header
            doc.fontSize(20).text('Attendance & Hours Report', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Report Type: ${reportType.toUpperCase()}`);
            doc.text(`Generated on: ${new Date().toLocaleString()}`);
            if (startDate) doc.text(`From: ${startDate}`);
            if (endDate) doc.text(`To: ${endDate}`);
            doc.moveDown();

            // Table Header
            if (reportType === 'workers' || reportType === 'foremen') {
                doc.fontSize(10).text('Name', 50, 200);
                doc.text('Role', 200, 200);
                doc.text('Total Hours', 300, 200);
                doc.text('Days Worked', 400, 200);
                doc.lineWidth(1).moveTo(50, 215).lineTo(550, 215).stroke();

                let y = 230;
                data.forEach(r => {
                    doc.text(r.fullName, 50, y);
                    doc.text(r.role, 200, y);
                    doc.text(r.totalHours.toString(), 300, y);
                    doc.text(r.totalDaysWorked.toString(), 400, y);
                    y += 20;
                    if (y > 700) { doc.addPage(); y = 50; }
                });
            } else {
                doc.fontSize(10).text('Project Name', 50, 200);
                doc.text('Worker Hrs', 200, 200);
                doc.text('Foreman Hrs', 300, 200);
                doc.text('Grand Total', 400, 200);
                doc.lineWidth(1).moveTo(50, 215).lineTo(550, 215).stroke();

                let y = 230;
                data.forEach(r => {
                    doc.text(r.projectName, 50, y);
                    doc.text(r.workerHours.toString(), 200, y);
                    doc.text(r.foremanHours.toString(), 300, y);
                    doc.text(r.totalHours.toString(), 400, y);
                    y += 20;
                    if (y > 700) { doc.addPage(); y = 50; }
                });
            }

            doc.end();
            return;
        }

        res.status(400).json({ message: 'Invalid export type' });
    } catch (error) {
        next(error);
    }
};

// @desc    Get detailed project report (Job-wise detailed data)
// @route   GET /api/reports/detailed/:projectId
// @access  Private (Admin, PM)
const getDetailedProjectReport = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const companyId = req.user.companyId;

        const project = await Project.findOne({ _id: projectId, companyId });
        if (!project) {
            res.status(404);
            throw new Error('Project not found');
        }

        const [jobs, projectTasks, projectRFIs] = await Promise.all([
            Job.find({ projectId, companyId }),
            Task.find({ projectId, companyId }).populate('assignedTo', 'fullName role'),
            RFI.find({ projectId, companyId })
        ]);

        const detailedJobs = await Promise.all(jobs.map(async (job) => {
            // Task Section: Fetch JobTasks and their SubTasks
            const jobTasks = await JobTask.find({ jobId: job._id }).populate('assignedTo', 'fullName role');
            const subTasks = await SubTask.find({ 
                taskId: { $in: jobTasks.map(t => t._id) },
                onModel: 'JobTask'
            }).populate('assignedTo', 'fullName role');

            // Map subtasks to their tasks
            const taskTree = jobTasks.map(task => {
                const associatedSubTasks = subTasks.filter(st => {
                    const tid = st.taskId?._id || st.taskId;
                    return tid?.toString() === task._id.toString();
                });
                
                return {
                    ...task.toObject(),
                    subtasks: associatedSubTasks
                };
            });

            // Workers & Subcontractors Section (TimeLogs)
            const jobTaskIds = jobTasks.map(t => t._id);
            const subTaskIds = subTasks.map(s => s._id);
            
            const timeLogs = await TimeLog.find({ 
                $or: [
                    { jobId: job._id },
                    { taskId: { $in: [...jobTaskIds, ...subTaskIds] } }
                ]
            }).populate('userId', 'fullName role hourlyRate');
            
            const workerData = {};
            const subcontractorData = {};

            timeLogs.forEach(log => {
                if (!log.clockIn || !log.userId) return;
                const end = log.clockOut || new Date();
                const hours = (new Date(end) - new Date(log.clockIn)) / (1000 * 60 * 60);
                const cost = hours * (log.userId.hourlyRate || 0);
                
                const target = log.userId.role === 'SUBCONTRACTOR' ? subcontractorData : workerData;
                const uid = log.userId._id.toString();

                if (!target[uid]) {
                    target[uid] = { 
                        name: log.userId.fullName, 
                        role: log.userId.role, 
                        totalHours: 0, 
                        cost: 0,
                        work: log.userId.role === 'SUBCONTRACTOR' ? 'Contracted Services' : 'Labour'
                    };
                }
                target[uid].totalHours += hours;
                target[uid].cost += cost;
            });

            // Equipment Section
            const equipments = await Equipment.find({ 
                companyId,
                $or: [
                    { assignedJob: job._id },
                    { 'assignmentHistory.jobId': job._id }
                ]
            });
            
            const equipData = equipments.map(e => {
                const relevantHistory = e.assignmentHistory.filter(h => h.jobId?.toString() === job._id.toString());
                
                let currentHours = 0;
                if (e.assignedJob?.toString() === job._id.toString() && e.assignedDate) {
                    const end = e.returnedDate || new Date();
                    currentHours = Math.max(0, (new Date(end) - new Date(e.assignedDate)) / (1000 * 60 * 60));
                }
                
                const historyHours = relevantHistory.reduce((acc, h) => {
                    const start = h.assignedDate || h.clockIn;
                    const end = h.returnedDate || h.clockOut || new Date();
                    if (!start) return acc;
                    return acc + Math.max(0, (new Date(end) - new Date(start)) / (1000 * 60 * 60));
                }, 0);
                
                const totalHours = historyHours + currentHours;
                return {
                    name: e.name || 'Unknown Equipment',
                    hoursUsed: totalHours.toFixed(1),
                    cost: (totalHours * (e.costPerHour || 0)).toFixed(2)
                };
            }).filter(e => parseFloat(e.hoursUsed) > 0);

            // Material Section (PurchaseOrders)
            const pos = await PurchaseOrder.find({ jobId: job._id, status: { $nin: ['Draft', 'Cancelled'] } });
            const materialData = pos.flatMap(po => po.items.map(item => ({
                itemName: item.itemName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                cost: item.total,
                poNumber: po.poNumber
            })));

            const workerTotal = Object.values(workerData).reduce((acc, w) => acc + w.cost, 0);
            const subTotal = Object.values(subcontractorData).reduce((acc, s) => acc + s.cost, 0);
            const equipTotal = equipData.reduce((acc, e) => acc + parseFloat(e.cost), 0);
            const materialTotal = materialData.reduce((acc, m) => acc + m.cost, 0);

            // Fetch Job Notes (detailed comments)
            const notes = await JobNote.find({ jobId: job._id }).populate('createdBy', 'fullName').sort({ createdAt: -1 });

            return {
                _id: job._id,
                jobName: job.name,
                description: job.description || '',
                notes: notes.map(n => ({
                    content: n.content,
                    author: n.createdBy?.fullName || 'System',
                    date: n.createdAt
                })),
                budget: job.budget || 0,
                status: job.status,
                startDate: job.startDate,
                endDate: job.endDate,
                totalCost: (workerTotal + subTotal + equipTotal + materialTotal).toFixed(2),
                progress: job.progress || 0,
                tasks: taskTree,
                workers: Object.values(workerData).map(w => ({ ...w, totalHours: w.totalHours.toFixed(1), cost: w.cost.toFixed(2) })),
                subcontractors: Object.values(subcontractorData).map(s => ({ ...s, totalHours: s.totalHours.toFixed(1), cost: s.cost.toFixed(2) })),
                equipment: equipData,
                materials: materialData,
                summary: {
                    totalTasks: jobTasks.length,
                    completedTasks: jobTasks.filter(t => t.status === 'completed').length,
                    pendingTasks: jobTasks.filter(t => t.status !== 'completed').length
                },
                financials: {
                    workerCost: workerTotal.toFixed(2),
                    subcontractorCost: subTotal.toFixed(2),
                    equipmentCost: equipTotal.toFixed(2),
                    materialCost: materialTotal.toFixed(2),
                    total: (workerTotal + subTotal + equipTotal + materialTotal).toFixed(2)
                }
            };
        }));

        // General project aggregation
        const totalTasksGlobal = detailedJobs.reduce((acc, j) => acc + (j.summary?.totalTasks || 0), 0) + projectTasks.length;
        const completedTasksGlobal = detailedJobs.reduce((acc, j) => acc + (j.summary?.completedTasks || 0), 0) + projectTasks.filter(t => t.status === 'completed').length;
        const totalCostGlobal = detailedJobs.reduce((acc, j) => acc + parseFloat(j.totalCost), 0);
        const totalHoursGlobal = detailedJobs.reduce((acc, j) => {
            const workerHrs = j.workers.reduce((wacc, w) => wacc + parseFloat(w.totalHours), 0);
            const subHrs = j.subcontractors.reduce((sacc, s) => sacc + parseFloat(s.totalHours), 0);
            return acc + workerHrs + subHrs;
        }, 0);
        
        const totalWorkersGlobal = new Set(detailedJobs.flatMap(j => j.workers.map(w => w.name))).size;

        res.json({
            project: {
                _id: project._id,
                name: project.name,
                budget: project.budget || 0,
                totalCost: totalCostGlobal.toFixed(2),
                remainingBudget: ( (project.budget || 0) - totalCostGlobal).toFixed(2),
                budgetUsedPercent: project.budget > 0 ? ((totalCostGlobal / project.budget) * 100).toFixed(1) : 0,
                totalJobs: detailedJobs.length,
                totalTasks: totalTasksGlobal,
                completedTasks: completedTasksGlobal,
                pendingTasks: totalTasksGlobal - completedTasksGlobal,
                totalWorkers: totalWorkersGlobal,
                totalHours: totalHoursGlobal.toFixed(1),
                rfis: projectRFIs.length
            },
            jobs: detailedJobs
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProjectReport,
    getCompanyReport,
    getDashboardStats,
    getWorkerAttendanceReport,
    getForemanAttendanceReport,
    getProjectAttendanceReport,
    exportAttendanceReport,
    getDetailedProjectReport
};
