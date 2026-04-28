const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: './.env' });
const connectDB = require('./config/db');
const Task = require('./models/Task');
const JobTask = require('./models/JobTask');
const SubTask = require('./models/SubTask');

const debug = async () => {
    await connectDB();
    
    // Find any "Concrete Work" task
    const tasks = await Task.find({ title: /Concrete Work/i });
    const jobTasks = await JobTask.find({ title: /Concrete Work/i });
    
    console.log('Found Tasks:', tasks.length);
    console.log('Found JobTasks:', jobTasks.length);
    
    const all = [...tasks, ...jobTasks];
    
    for (const t of all) {
        console.log(`\nChecking Task ID: ${t._id} (${t.title})`);
        console.log(`Status: ${t.status}, Progress: ${t.progress}`);
        
        const subTasks = await SubTask.find({ taskId: t._id });
        console.log(`Total SubTasks in DB: ${subTasks.length}`);
        
        const topLevel = subTasks.filter(st => !st.parentSubTaskId);
        console.log(`Top-level SubTasks: ${topLevel.length}`);
        
        const completed = subTasks.filter(st => st.status === 'completed');
        console.log(`Completed SubTasks: ${completed.length}`);
        
        if (subTasks.length > 0) {
            const calculatedProgress = Math.round((completed.length / subTasks.length) * 100);
            console.log(`Calculated Progress (All): ${calculatedProgress}%`);
            
            const topLevelCompleted = topLevel.filter(st => st.status === 'completed');
            const calculatedTopProgress = topLevel.length > 0 ? Math.round((topLevelCompleted.length / topLevel.length) * 100) : 0;
            console.log(`Calculated Progress (Top-level): ${calculatedTopProgress}%`);
        }
    }
    
    mongoose.connection.close();
};

debug();
