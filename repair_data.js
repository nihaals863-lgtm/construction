const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: './.env' });
const connectDB = require('./config/db');
const Task = require('./models/Task');
const JobTask = require('./models/JobTask');
const SubTask = require('./models/SubTask');

const repair = async () => {
    await connectDB();
    console.log('--- Starting Data Repair ---');
    
    const allTasks = await Task.find({});
    const allJobTasks = await JobTask.find({});
    const allSubTasks = await SubTask.find({});
    
    const tasks = [...allTasks, ...allJobTasks];
    console.log(`Checking ${tasks.length} tasks...`);
    
    for (const t of tasks) {
        const tSubTasks = allSubTasks.filter(st => 
            st.taskId?.toString() === t._id.toString() && 
            (!st.parentSubTaskId || st.parentSubTaskId === null)
        );
        
        if (tSubTasks.length > 0) {
            const completedCount = tSubTasks.filter(st => st.status === 'completed').length;
            const progress = Math.round((completedCount / tSubTasks.length) * 100);
            
            if (t.progress !== progress) {
                console.log(`Repairing [${t._id}] ${t.title}: ${t.progress}% -> ${progress}%`);
                const Model = allTasks.some(at => at._id.equals(t._id)) ? Task : JobTask;
                await Model.findByIdAndUpdate(t._id, { progress });
            }
        }
    }
    
    console.log('--- Data Repair Finished ---');
    mongoose.connection.close();
};

repair();
