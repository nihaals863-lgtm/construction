// Clone construction-saas from Atlas to local MongoDB
const atlasUri = "mongodb+srv://bard_admin:Bard@Construction2026!!@bard-construction-clust.tarehtj.mongodb.net/?appName=bard-construction-cluster";
const localUri = "mongodb://127.0.0.1:27017";

print("Connecting to Atlas and Local MongoDB...");
const sourceConn = new Mongo(atlasUri);
const sourceDb = sourceConn.getDB("construction-saas");

const localConn = new Mongo(localUri);
const localDb = localConn.getDB("construction-saas");

const collections = sourceDb.getCollectionNames();
print(`Found ${collections.length} collections. Starting sync to local MongoDB...`);

for (const colName of collections) {
    if (colName.startsWith("system.")) continue;
    const count = sourceDb.getCollection(colName).countDocuments();
    print(`Copying ${colName} (${count} docs)...`);
    
    localDb.getCollection(colName).drop();
    
    if (count > 0) {
        const docs = sourceDb.getCollection(colName).find().toArray();
        localDb.getCollection(colName).insertMany(docs);
    }
}

print("\n--- Synchronization Complete! ---");
print("Local database 'construction-saas' is ready.");
