const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/construction-saas";
const dbName = "construction-saas";
const exportDir = path.resolve(__dirname, '../../db_export');

async function exportDatabase() {
    console.log(`Connecting to MongoDB: ${mongoUri}...`);
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to MongoDB successfully.');

        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();

        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        console.log(`Exporting ${collections.length} collections to: ${exportDir}`);

        const summary = [];

        for (const col of collections) {
            const colName = col.name;
            if (colName.startsWith('system.')) continue;

            const collection = db.collection(colName);
            const count = await collection.countDocuments();
            const docs = await collection.find({}).toArray();

            const filePath = path.join(exportDir, `${colName}.json`);
            fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf-8');

            summary.push({ collection: colName, count, file: `${colName}.json` });
            console.log(`✓ Exported ${colName}: ${count} documents -> ${colName}.json`);
        }

        // Write summary manifest
        fs.writeFileSync(
            path.join(exportDir, '_export_summary.json'),
            JSON.stringify({ exportedAt: new Date().toISOString(), dbName, totalCollections: summary.length, collections: summary }, null, 2),
            'utf-8'
        );

        console.log(`\nAll collections successfully exported to: ${exportDir}`);
    } catch (err) {
        console.error('Error during export:', err);
    } finally {
        await client.close();
    }
}

exportDatabase();
