const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Company = require('./models/Company');
const Plan = require('./models/Plan');
const User = require('./models/User');

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected');
    
    // Find gurucharan company (user shown in screenshot)
    const owner = await User.findOne({ fullName: 'gurucharan' });
    if (!owner) {
        console.log('Owner gurucharan not found');
        return;
    }
    
    console.log('Owner Company ID:', owner.companyId);
    
    const company = await Company.findById(owner.companyId);
    console.log('Company:', company.name);
    console.log('Subscription Plan ID:', company.subscriptionPlanId);
    
    const planQuery = mongoose.Types.ObjectId.isValid(company.subscriptionPlanId)
                ? { _id: company.subscriptionPlanId }
                : { name: new RegExp('^' + company.subscriptionPlanId + '$', 'i') };
                
    const plan = await Plan.findOne(planQuery);
    
    if (plan) {
        console.log('Plan matched:', plan.name, 'Max Users:', plan.maxUsers, 'Max Projects:', plan.maxProjects);
    } else {
        console.log('No plan matched for query:', planQuery);
        // List all plans to see what we have
        const allPlans = await Plan.find({});
        console.log('Available plans:', allPlans.map(p => ({ id: p._id, name: p.name })));
    }
    
    process.exit(0);
}

test().catch(console.error);
