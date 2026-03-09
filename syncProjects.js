const mongoose = require('mongoose');
const Project = require('./models/Project');
const Job = require('./models/Job');
require('dotenv').config();

const syncAllProjects = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const projects = await Project.find({});
        console.log(`Syncing ${projects.length} projects...`);

        for (const project of projects) {
            const jobs = await Job.find({ projectId: project._id });
            if (jobs.length === 0) {
                await Project.findByIdAndUpdate(project._id, { progress: 0, status: 'planning' });
                continue;
            }

            const completedJobs = jobs.filter(j => j.status === 'completed').length;
            const activeJobs = jobs.filter(j => j.status === 'active' || j.status === 'on-hold').length;
            const progress = Math.round((completedJobs / jobs.length) * 100);

            let status = 'planning';
            if (progress === 100) {
                status = 'completed';
            } else if (progress > 0 || activeJobs > 0) {
                status = 'active';
            }

            await Project.findByIdAndUpdate(project._id, { progress, status });
            console.log(`Project "${project.name}": Progress ${progress}%, Status ${status}`);
        }

        console.log('Sync complete!');
        process.exit(0);
    } catch (err) {
        console.error('Sync failed:', err);
        process.exit(1);
    }
};

syncAllProjects();
