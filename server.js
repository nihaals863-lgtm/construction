require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const { errorHandler } = require('./middlewares/errorMiddleware');

// Route Imports
const authRoutes = require('./routes/authRoutes');
const companyRoutes = require('./routes/companyRoutes');
const projectRoutes = require('./routes/projectRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const taskRoutes = require('./routes/taskRoutes');
const timeLogRoutes = require('./routes/timeLogRoutes');
const photoRoutes = require('./routes/photoRoutes');
const drawingRoutes = require('./routes/drawingRoutes');
const issueRoutes = require('./routes/issueRoutes');
const dailyLogRoutes = require('./routes/dailyLogRoutes');
const estimateRoutes = require('./routes/estimateRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const chatRoutes = require('./routes/chatRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const roleRoutes = require('./routes/roleRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const planRoutes = require('./routes/planRoutes');
const jobRoutes = require('./routes/jobRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes');
const rfiRoutes = require('./routes/rfiRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const correctionRoutes = require('./routes/correctionRoutes');
const jobTaskRoutes = require('./routes/jobTaskRoutes');
const taskTemplateRoutes = require('./routes/taskTemplateRoutes');
const todoRoutes = require('./routes/todoRoutes');

const app = express();
const server = http.createServer(app);

// Socket.io Setup
const io = new Server(server, {
    cors: {
        origin: "*" , // Allow all origins for now (adjust for production)
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
    }
});

// Connect to Database handled at bottom of file

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));

// Static files
app.use('/uploads', cors(), express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/timelogs', timeLogRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/drawings', drawingRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/dailylogs', dailyLogRoutes);
app.use('/api/estimates', estimateRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/rfis', rfiRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/corrections', correctionRoutes);
app.use('/api/job-tasks', jobTaskRoutes);
app.use('/api/task-templates', taskTemplateRoutes);
app.use('/api/todos', todoRoutes);

// Root Route
app.get('/', (req, res) => {
    res.send('Construction SaaS Backend API is running...');
});

// Online User Tracking
const onlineUsers = new Map();

const jwt = require('jsonwebtoken');

// Socket.io JWT Authentication Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
        return next(new Error('Authentication error: Token missing'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded; // Contains id, role, etc.
        next();
    } catch (err) {
        return next(new Error('Authentication error: Invalid token'));
    }
});

// Socket.io Connection
io.on('connection', async (socket) => {
    console.log('New client connected:', socket.id, 'User:', socket.user.id);

    // Join personal room
    socket.join(socket.user.id);

    // Join all chat rooms the user is a participant of
    try {
        const ChatParticipant = require('./models/ChatParticipant');
        const participants = await ChatParticipant.find({ userId: socket.user.id });
        participants.forEach(p => {
            socket.join(p.roomId.toString());
            console.log(`User ${socket.user.id} joined room ${p.roomId}`);
        });
    } catch (err) {
        console.error('Error joining rooms on connect:', err);
    }

    // Register User (Keep for legacy or extra metadata if needed, but token is primary)
    socket.on('register_user', (userData) => {
        if (userData && userData._id) {
            onlineUsers.set(socket.id, {
                userId: userData._id,
                fullName: userData.fullName,
                role: userData.role,
                companyId: userData.companyId,
                lat: userData.lat || null,
                lng: userData.lng || null
            });

            // Update every client with new online count
            io.emit('online_users_count', onlineUsers.size);
            io.emit('user_status_change', { userId: userData._id, status: 'online' });
        }
    });

    // Handle room joining dynamically (e.g. when a new room is created)
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.user.id} joined room manually: ${roomId}`);
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            onlineUsers.delete(socket.id);
            io.emit('online_users_count', onlineUsers.size);
            io.emit('user_status_change', { userId: user.userId, status: 'offline' });
        }
        console.log('Client disconnected:', socket.id);
    });
});

// Make io available in routes
app.set('io', io);

// Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

// Connect to Database and Start Server
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
});
