const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: 'c:/Users/91969/OneDrive/Documents/Kiaan Project/Construction New/Construction-Backend/.env' });

const Permission = mongoose.model('Permission', new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    module: { type: String, required: true },
    description: String
}, { timestamps: true }));

const permissionsData = [
    // Dashboard
    { key: 'VIEW_DASHBOARD', module: 'DASHBOARD', description: 'View main company dashboard' },
    
    // Projects
    { key: 'VIEW_PROJECTS', module: 'PROJECT', description: 'View project/job list and details' },
    { key: 'CREATE_PROJECT', module: 'PROJECT', description: 'Create new projects' },
    { key: 'EDIT_PROJECT', module: 'PROJECT', description: 'Edit existing project details' },
    
    // Tasks
    { key: 'VIEW_TASKS', module: 'TASK', description: 'View assigned and project tasks' },
    { key: 'CREATE_TASKS', module: 'TASK', description: 'Create new tasks' },
    { key: 'UPDATE_TASKS', module: 'TASK', description: 'Update status of tasks' },
    
    // RFI
    { key: 'VIEW_RFI', module: 'RFI', description: 'View requests for information' },
    { key: 'CREATE_RFI', module: 'RFI', description: 'Raise new RFIs' },
    { key: 'RESPOND_RFI', module: 'RFI', description: 'Respond to raised RFIs' },
    
    // Chat
    { key: 'VIEW_CHAT', module: 'CHAT', description: 'Access team and project chat' },
    { key: 'SEND_MESSAGES', module: 'CHAT', description: 'Send messages in channels' },
    
    // Documents
    { key: 'VIEW_DOCUMENTS', module: 'DOCUMENT', description: 'View project documents' },
    { key: 'UPLOAD_DOCUMENTS', module: 'DOCUMENT', description: 'Upload new documents' },
    
    // Drawings
    { key: 'VIEW_DRAWINGS', module: 'DRAWING', description: 'View project drawings' },
    { key: 'UPLOAD_DRAWINGS', module: 'DRAWING', description: 'Upload new blueprints' },
    
    // Reports
    { key: 'VIEW_REPORTS', module: 'REPORT', description: 'View generated analytics reports' },
    
    // Trade Management
    { key: 'VIEW_TRADES', module: 'TRADE', description: 'View trades and subcontractors' },
    { key: 'CREATE_TRADES', module: 'TRADE', description: 'Add new trade entities' },
    
    // Financial
    { key: 'VIEW_INVOICES', module: 'FINANCIAL', description: 'View billing and invoices' },
    { key: 'VIEW_PO', module: 'FINANCIAL', description: 'View purchase orders' },
    { key: 'VIEW_PAYROLL', module: 'FINANCIAL', description: 'Access payroll summaries' },
    
    // Attendance/Time
    { key: 'CLOCK_IN_OUT', module: 'ATTENDANCE', description: 'Self clock-in and clock-out' },
    { key: 'CLOCK_IN_CREW', module: 'ATTENDANCE', description: 'Clock in other team members' },
    { key: 'VIEW_TIMESHEETS', module: 'ATTENDANCE', description: 'View submitted timesheets' },
    
    // Other
    { key: 'ACCESS_SETTINGS', module: 'OTHER', description: 'Manage company settings' },
    { key: 'VIEW_TEAM', module: 'OTHER', description: 'View employee/user directory' },
    { key: 'VIEW_GPS', module: 'OTHER', description: 'Access live GPS tracking' },
    { key: 'VIEW_EQUIPMENT', module: 'OTHER', description: 'Manage machinery and equipment' },
    { key: 'VIEW_DAILY_LOGS', module: 'OTHER', description: 'Access project daily logs' },
    { key: 'VIEW_PHOTOS', module: 'OTHER', description: 'View project site photos' }
];

const seedPermissions = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        for (const data of permissionsData) {
            await Permission.findOneAndUpdate(
                { key: data.key },
                data,
                { upsert: true, new: true }
            );
        }

        console.log('Permissions seeded successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding error:', error);
        process.exit(1);
    }
};

seedPermissions();
