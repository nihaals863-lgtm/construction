require('dotenv').config();
const mongoose = require('mongoose');
const RolePermission = require('./models/RolePermission');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const exists = await RolePermission.findOne({ role: 'SUBCONTRACTOR' });
    if (exists) {
        console.log('SUBCONTRACTOR role already exists in DB');
    } else {
        await RolePermission.create({
            role: 'SUBCONTRACTOR',
            permissions: ['VIEW_DASHBOARD', 'VIEW_PROJECTS', 'VIEW_SCHEDULE', 'VIEW_MY_TASKS', 'CLOCK_IN_OUT', 'VIEW_DRAWINGS', 'VIEW_PHOTOS', 'VIEW_DAILY_LOGS', 'VIEW_ISSUES', 'VIEW_CHAT', 'VIEW_EQUIPMENT', 'VIEW_TIMESHEETS']
        });
        console.log('✅ SUBCONTRACTOR role created in DB!');
    }
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
