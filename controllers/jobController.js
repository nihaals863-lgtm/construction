const Job = require('../models/Job');
const Project = require('../models/Project');
const JobWorker = require('../models/JobWorker');
const JobTimeLog = require('../models/JobTimeLog');
const JobActivityLog = require('../models/JobActivityLog');
const JobNote = require('../models/JobNote');
const { dispatchNotification } = require('../utils/notificationHelper');
const mongoose = require('mongoose');

// Helper to update project stats (Disabled automatic progress/status as per manual control requirement)
const updateProjectStats = async (projectId) => {
    // Automatic updates disabled to allow manual admin control over project progress and status
    return;
};

// GET /jobs?projectId=xxx  — list jobs for a project
const getJobs = async (req, res) => {
    try {
        const filter = {};
        if (req.user.role !== 'SUPER_ADMIN') {
            filter.companyId = req.user.companyId;
        }

        // If projectId is provided, use it
        if (req.query.projectId) {
            filter.projectId = req.query.projectId;
        }

        // Role-based visibility
        if (req.user.role === 'PM') {
            // PM sees jobs for projects where they are the PM OR the creator
            const managedProjects = await Project.find({
                companyId: req.user.companyId,
                $or: [{ pmId: req.user._id }, { createdBy: req.user._id }]
            }).select('_id');
            const projectIds = managedProjects.map(p => p._id);

            // Visibility criteria for PM:
            // 1. Job is in a project they manage (PM/Creator)
            // 2. Job was created by them
            // 3. Job is assigned to them as a foreman (dual role)
            filter.$or = [
                { projectId: { $in: projectIds } },
                { createdBy: req.user._id },
                { foremanId: req.user._id }
            ];
        } else if (req.user.role === 'FOREMAN') {
            const JobTask = require('../models/JobTask');
            const userTasks = await JobTask.find({
                $or: [{ assignedTo: req.user._id }, { assignedForeman: req.user._id }]
            }).select('jobId');
            const taskJobIds = userTasks.map(t => t.jobId);
            filter.$or = [
                { foremanId: req.user._id },
                { _id: { $in: taskJobIds } }
            ];
        } else if (req.user.role === 'WORKER') {
            const JobTask = require('../models/JobTask');
            const userTasks = await JobTask.find({ assignedTo: req.user._id }).select('jobId');
            const taskJobIds = userTasks.map(t => t.jobId);
            filter.$or = [
                { assignedWorkers: { $in: [req.user._id] } },
                { _id: { $in: taskJobIds } }
            ];
        }

        const jobs = await Job.find(filter)
            .populate('foremanId', 'fullName role')
            .populate('assignedWorkers', 'fullName role')
            .populate({
                path: 'projectId',
                select: 'name pmId',
                populate: { path: 'pmId', select: 'fullName' }
            })
            .sort({ createdAt: -1 });
        res.json(jobs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /jobs/:id
const getJobById = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id)
            .populate('foremanId', 'fullName role')
            .populate('assignedWorkers', 'fullName role')
            .populate({
                path: 'projectId',
                select: 'name pmId',
                populate: { path: 'pmId', select: 'fullName' }
            });
        if (!job) return res.status(404).json({ message: 'Job not found' });
        res.json(job);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /jobs
const createJob = async (req, res) => {
    try {
        const { equipmentIds, ...jobData } = req.body;
        const job = await Job.create({
            ...jobData,
            companyId: req.user.companyId,
            createdBy: req.user._id
        });

        // If equipmentIds are provided, assign them to the new job
        if (equipmentIds && Array.isArray(equipmentIds)) {
            const Equipment = require('../models/Equipment');
            await Equipment.updateMany(
                { _id: { $in: equipmentIds }, companyId: req.user.companyId },
                {
                    assignedJob: job._id,
                    assignedDate: new Date(),
                    status: 'operational'
                }
            );
        }

        // Sync project stats
        await updateProjectStats(job.projectId);

        // Sync Chat Participants
        try {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(job.projectId);

            // Notify Foreman
            if (job.foremanId) {
                await dispatchNotification(req, {
                    userId: job.foremanId,
                    title: 'New Job Assigned',
                    message: `You have been assigned as Foreman for job: "${job.name}"`,
                    link: '/projects',
                    type: 'project'
                });
            }

            // Notify Workers
            for (const workerId of (job.assignedWorkers || [])) {
                await dispatchNotification(req, {
                    userId: workerId,
                    title: 'New Job Assignment',
                    message: `You have been assigned to job: "${job.name}"`,
                    link: '/projects',
                    type: 'project'
                });
            }
        } catch (syncError) {
            console.error('Job Create: Failed to sync chat participants/notifications:', syncError);
        }

        // Create initial Activity Log
        await JobActivityLog.create({
            jobId: job._id,
            actionType: 'CREATED',
            description: `Job "${job.name}" was created.`,
            createdBy: req.user._id
        });

        // Record initial worker assignments
        if (job.assignedWorkers && job.assignedWorkers.length > 0) {
            const workerAssignments = job.assignedWorkers.map(wId => ({
                jobId: job._id,
                workerId: wId,
                assignedAt: new Date()
            }));
            await JobWorker.insertMany(workerAssignments);

            await JobActivityLog.create({
                jobId: job._id,
                actionType: 'WORKER_ADDED',
                description: `${job.assignedWorkers.length} workers assigned at creation.`,
                createdBy: req.user._id
            });
        }

        if (job.foremanId) {
            await JobActivityLog.create({
                jobId: job._id,
                actionType: 'FOREMAN_CHANGED',
                description: `Foreman assigned during creation.`,
                createdBy: req.user._id
            });
        }

        const populated = await job.populate('foremanId', 'fullName role');
        res.status(201).json(populated);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// PATCH /jobs/:id
const updateJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ message: 'Job not found' });

        const oldStatus = job.status;
        const oldForemanId = job.foremanId?.toString();
        const oldWorkers = job.assignedWorkers.map(id => id.toString());

        // Workers can only update status
        if (req.user.role === 'WORKER') {
            const { status } = req.body;
            job.status = status || job.status;
        } else {
            Object.assign(job, req.body);
        }

        await job.save();

        // 1. Log Status Change
        if (req.body.status && req.body.status !== oldStatus) {
            await JobActivityLog.create({
                jobId: job._id,
                actionType: 'STATUS_CHANGED',
                description: `Status changed from ${oldStatus} to ${req.body.status}.`,
                createdBy: req.user._id
            });
            if (req.body.status === 'completed') {
                await JobActivityLog.create({
                    jobId: job._id,
                    actionType: 'COMPLETED',
                    description: `Job marked as completed.`,
                    createdBy: req.user._id
                });
            }
        }

        // 2. Log Foreman Change
        if (req.body.foremanId && req.body.foremanId.toString() !== oldForemanId) {
            await JobActivityLog.create({
                jobId: job._id,
                actionType: 'FOREMAN_CHANGED',
                description: `Foreman changed.`,
                createdBy: req.user._id
            });
        }

        // 3. Log & Update Worker Assignments
        if (req.body.assignedWorkers) {
            const newWorkers = req.body.assignedWorkers.map(id => {
                if (typeof id === 'object' && id !== null) {
                    return (id._id || id).toString();
                }
                return id.toString();
            });

            // Freshly added
            const added = newWorkers.filter(id => !oldWorkers.includes(id));
            if (added.length > 0) {
                await JobWorker.insertMany(added.map(wId => ({
                    jobId: job._id,
                    workerId: wId,
                    assignedAt: new Date()
                })));
                await JobActivityLog.create({
                    jobId: job._id,
                    actionType: 'WORKER_ADDED',
                    description: `Added ${added.length} workers to job.`,
                    createdBy: req.user._id
                });
            }

            // Removed
            const removed = oldWorkers.filter(id => !newWorkers.includes(id));
            if (removed.length > 0) {
                await JobWorker.updateMany(
                    { jobId: job._id, workerId: { $in: removed }, removedAt: { $exists: false } },
                    { removedAt: new Date() }
                );
                await JobActivityLog.create({
                    jobId: job._id,
                    actionType: 'WORKER_REMOVED',
                    description: `Removed ${removed.length} workers from job.`,
                    createdBy: req.user._id
                });
            }
        }

        // Sync project stats
        await updateProjectStats(job.projectId);

        // Sync Chat Participants
        try {
            const { syncProjectParticipants } = require('./chatController');
            await syncProjectParticipants(job.projectId);

            // Notify Foreman (if changed or set)
            if (job.foremanId) {
                await dispatchNotification(req, {
                    userId: job.foremanId,
                    title: 'Job Updated',
                    message: `Assignments updated for job: "${job.name}"`,
                    link: '/projects',
                    type: 'project'
                });
            }

            // Notify Workers
            for (const workerId of (job.assignedWorkers || [])) {
                await dispatchNotification(req, {
                    userId: workerId,
                    title: 'Job Updated',
                    message: `Assignments updated for job: "${job.name}"`,
                    link: '/projects',
                    type: 'project'
                });
            }
        } catch (syncError) {
            console.error('Job Update: Failed to sync chat participants/notifications:', syncError);
        }

        const populated = await Job.findById(job._id)
            .populate('foremanId', 'fullName role')
            .populate('assignedWorkers', 'fullName role');
        res.json(populated);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// DELETE /jobs/:id
const deleteJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);
        if (!job) return res.status(404).json({ message: 'Job not found' });

        const projectId = job.projectId;
        const JobTask = require('../models/JobTask');
        const TimeLog = require('../models/TimeLog');

        await JobTask.deleteMany({ jobId: req.params.id });
        await TimeLog.deleteMany({ jobId: req.params.id });
        await Job.findByIdAndDelete(req.params.id);

        // Sync project stats
        await updateProjectStats(projectId);

        res.json({ message: 'Job deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /jobs/:id/full-history
const getJobFullHistory = async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = await Job.findById(jobId)
            .populate('projectId', 'name')
            .populate('foremanId', 'fullName')
            .populate('assignedWorkers', 'fullName');

        if (!job) return res.status(404).json({ message: 'Job not found' });

        // 1. Fetch Daily Logs
        const TimeLog = require('../models/TimeLog');
        const rawTimeLogs = await TimeLog.find({ jobId })
            .populate('userId', 'fullName')
            .sort({ clockIn: -1 });

        const dailyLogs = rawTimeLogs.map(log => {
            const duration = log.clockOut ? ((new Date(log.clockOut) - new Date(log.clockIn)) / 3600000) : 0;
            return {
                workerId: log.userId,
                workDate: log.clockIn,
                checkIn: log.clockIn,
                checkOut: log.clockOut,
                totalHours: duration
            };
        });

        // 2. Fetch Activity Logs
        const activityLogs = await JobActivityLog.find({ jobId })
            .populate('createdBy', 'fullName')
            .sort({ createdAt: -1 });

        // 3. Aggregate Worker Summary
        // We'll calculate totals from time logs
        const workerStats = await TimeLog.aggregate([
            { $match: { jobId: new mongoose.Types.ObjectId(jobId) } },
            {
                $addFields: {
                    durationHrs: {
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
                    _id: '$userId',
                    totalHours: { $sum: '$durationHrs' },
                    totalDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$clockIn" } } }
                }
            },
            {
                $project: {
                    workerId: '$_id',
                    totalHours: 1,
                    totalDays: { $size: '$totalDays' },
                    avgHours: { $cond: [{ $eq: [{ $size: '$totalDays' }, 0] }, 0, { $divide: ['$totalHours', { $size: '$totalDays' }] }] }
                }
            }
        ]);

        // Populate worker names for stats
        const User = require('../models/User');
        const populatedWorkerStats = await Promise.all(workerStats.map(async (stat) => {
            const user = await User.findById(stat.workerId).select('fullName');
            return {
                ...stat,
                workerName: user ? user.fullName : 'Unknown'
            };
        }));

        // 4. Fetch Actual TimeLogs for this job (from comprehensive TimeLog model instead of basic JobTimeLog)
        const actualTimeLogs = await TimeLog.aggregate([
            { $match: { jobId: new mongoose.Types.ObjectId(jobId) } },
            {
                $addFields: {
                    durationHrs: {
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
                    _id: "$taskId",
                    totalTaskHours: { $sum: "$durationHrs" }
                }
            },
            {
                $lookup: {
                    from: "jobtasks",
                    localField: "_id",
                    foreignField: "_id",
                    as: "taskDetails"
                }
            },
            { $unwind: { path: "$taskDetails", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    taskId: "$_id",
                    taskName: "$taskDetails.title",
                    totalTaskHours: 1
                }
            }
        ]);


        res.json({
            job_details: job,
            worker_summary: populatedWorkerStats,
            daily_logs: dailyLogs,
            activity_logs: activityLogs,
            task_summary: actualTimeLogs
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /jobs/:id/history-pdf
const generateJobHistoryPDF = async (req, res) => {
    try {
        const jobId = req.params.id;
        const job = await Job.findById(jobId)
            .populate('projectId', 'name')
            .populate('foremanId', 'fullName');

        if (!job) return res.status(404).json({ message: 'Job not found' });

        const TimeLog = require('../models/TimeLog');
        const rawTimeLogsPdf = await TimeLog.find({ jobId })
            .populate('userId', 'fullName')
            .sort({ clockIn: -1 });

        const dailyLogs = rawTimeLogsPdf.map(log => {
            const duration = log.clockOut ? ((new Date(log.clockOut) - new Date(log.clockIn)) / 3600000) : 0;
            return {
                workerId: log.userId,
                workDate: log.clockIn,
                checkIn: log.clockIn,
                checkOut: log.clockOut,
                totalHours: duration
            };
        });

        const activityLogs = await JobActivityLog.find({ jobId })
            .populate('createdBy', 'fullName')
            .sort({ createdAt: -1 });

        const PDFDocument = require('pdfkit');
        // Define standard margins
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        let filename = `${job.name}_Report.pdf`;
        filename = encodeURIComponent(filename);
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');

        doc.pipe(res);

        // --- Helper functions for drawing ---
        const drawHorizontalLine = (yPos) => doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, yPos).lineTo(545, yPos).stroke();

        // 1. Header Section
        doc.fillColor('#1e293b').fontSize(24).font('Helvetica-Bold').text('KAAL CONSTRUCTION', 50, 50);
        doc.fillColor('#64748b').fontSize(10).font('Helvetica').text('11520 84 street Nw, Edmonton,\nAlberta T5B 3B8, Canada', 50, 75);

        // Invoice/Report Title block on the right
        doc.fillColor('#1e293b').fontSize(22).font('Helvetica-Bold').text('JOB HISTORY REPORT', 320, 50, { align: 'right' });
        doc.fontSize(10).fillColor('#64748b').font('Helvetica');
        doc.text(`Reference No: ${job._id.toString().substring(0, 8).toUpperCase()}`, { align: 'right' });
        doc.text(`Date Issued: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`, { align: 'right' });

        doc.moveDown(3);
        const yAfterHeader = doc.y + 10;

        // 2. Info Grid
        doc.roundedRect(50, yAfterHeader, 240, 100, 5).fill('#f8fafc').stroke('#e5e7eb');
        doc.roundedRect(305, yAfterHeader, 240, 100, 5).fill('#f8fafc').stroke('#e5e7eb');

        // Project / Job Box
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica-Bold').text('PROJECT DETAILS', 65, yAfterHeader + 15);
        doc.fillColor('#1e293b').fontSize(11).text(job.projectId?.name || 'N/A', 65, yAfterHeader + 30);
        doc.fillColor('#64748b').fontSize(10).font('Helvetica').text(`Job: ${job.name}`, 65, yAfterHeader + 50);
        doc.text(`Status: ${job.status.toUpperCase()}`, 65, yAfterHeader + 65);

        // Assignment Box
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica-Bold').text('PEOPLE INVOLVED', 320, yAfterHeader + 15);
        doc.fillColor('#1e293b').fontSize(11).text(`Foreman: ${job.foremanId?.fullName || 'Unassigned'}`, 320, yAfterHeader + 30);

        doc.moveDown(3);
        let currentY = yAfterHeader + 120;

        // --- Worker Summary Aggregation Calculation ---
        const workerStats = await TimeLog.aggregate([
            { $match: { jobId: new mongoose.Types.ObjectId(jobId) } },
            {
                $addFields: {
                    durationHrs: {
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
                    _id: '$userId',
                    totalHours: { $sum: '$durationHrs' },
                    days: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$clockIn" } } }
                }
            }
        ]);

        const User = require('../models/User');

        doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Worker Aggregation', 50, currentY);
        currentY += 25;

        // Table Header
        doc.fillColor('#f1f5f9').rect(50, currentY, 495, 25).fill();
        doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold');
        doc.text('WORKER NAME', 60, currentY + 8);
        doc.text('DAYS ATTENDED', 250, currentY + 8);
        doc.text('TOTAL HOURS', 450, currentY + 8, { align: 'right' });

        currentY += 30;

        // Table Rows
        doc.font('Helvetica').fontSize(9);
        for (let i = 0; i < workerStats.length; i++) {
            const stat = workerStats[i];
            const user = await User.findById(stat._id).select('fullName');

            if (i % 2 === 0) {
                doc.fillColor('#f8fafc').rect(50, currentY - 5, 495, 20).fill();
            }

            doc.fillColor('#334155');
            doc.text(user?.fullName || 'Unknown Employee', 60, currentY);
            doc.text(stat.days.length.toString(), 250, currentY);
            doc.text(`${stat.totalHours.toFixed(2)} hrs`, 450, currentY, { align: 'right' });

            currentY += 20;

            if (currentY > 750) {
                doc.addPage();
                currentY = 50;
            }
        }

        currentY += 20;

        // --- Daily Logs Section ---
        if (currentY > 650) { doc.addPage(); currentY = 50; }

        doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text('Detailed Daily Time Logs', 50, currentY);
        currentY += 25;

        dailyLogs.forEach((log) => {
            if (currentY > 780) { doc.addPage(); currentY = 50; }

            doc.fillColor('#f1f5f9').roundedRect(50, currentY, 495, 30, 4).fill();

            doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text(new Date(log.workDate).toLocaleDateString(), 60, currentY + 10);
            doc.font('Helvetica').text(log.workerId?.fullName || 'Unknown', 140, currentY + 10);

            const timeStr = `${new Date(log.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${log.checkOut ? new Date(log.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}`;
            doc.fillColor('#64748b').text(timeStr, 280, currentY + 10);

            doc.font('Helvetica-Bold').fillColor('#0ea5e9').text(`${log.totalHours.toFixed(2)} hrs`, 450, currentY + 10, { align: 'right' });

            currentY += 35;
        });

        currentY += 20;

        // --- Footer Note ---
        if (currentY > 720) { doc.addPage(); currentY = 50; }

        drawHorizontalLine(Math.max(currentY, 730));
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica');
        doc.text('Thank you for choosing KAAL Construction. This is a system-generated report.', 50, Math.max(currentY, 730) + 15, { align: 'center', width: 495 });

        doc.end();

    } catch (err) {
        console.error('PDF Generation Error:', err);
        res.status(500).json({ message: err.message });
    }
};

// GET /jobs/:id/notes
const getJobNotes = async (req, res) => {
    try {
        const notes = await JobNote.find({ 
            jobId: req.params.id, 
            companyId: req.user.companyId 
        })
        .populate('createdBy', 'fullName avatar')
        .sort({ createdAt: -1 });
        
        res.json(notes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /jobs/:id/notes
const createJobNote = async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ message: 'Content is required' });

        const note = await JobNote.create({
            jobId: req.params.id,
            companyId: req.user.companyId,
            content,
            createdBy: req.user._id
        });

        const populated = await JobNote.findById(note._id).populate('createdBy', 'fullName avatar');
        res.status(201).json(populated);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// DELETE /jobs/:id/notes/:noteId
const deleteJobNote = async (req, res) => {
    try {
        const note = await JobNote.findOneAndDelete({
            _id: req.params.noteId,
            companyId: req.user.companyId
        });
        
        if (!note) return res.status(404).json({ message: 'Note not found' });
        
        res.json({ message: 'Note deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
    getJobs,
    getJobById,
    createJob,
    updateJob,
    deleteJob,
    getJobFullHistory,
    generateJobHistoryPDF,
    getJobNotes,
    createJobNote,
    deleteJobNote
};
