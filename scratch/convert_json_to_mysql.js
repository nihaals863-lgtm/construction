const fs = require('fs');
const path = require('path');

const dbExportDir = path.resolve(__dirname, '../../db_export');
const outputSqlFile = path.resolve(__dirname, '../../construction_mysql_dump.sql');

function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeSqlVal(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return isNaN(val) ? 'NULL' : val;
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (typeof val === 'object') {
        const str = JSON.stringify(val);
        return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    }
    const str = String(val);
    return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function inferType(val) {
    if (val === null || val === undefined) return 'TEXT';
    if (typeof val === 'boolean') return 'TINYINT(1)';
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return 'BIGINT';
        return 'DOUBLE';
    }
    if (typeof val === 'string') {
        if (val.length <= 64 && /^[0-9a-fA-F]{24}$/.test(val)) return 'VARCHAR(64)';
        if (val.length <= 128) return 'VARCHAR(255)';
        if (val.length <= 500) return 'VARCHAR(500)';
        return 'LONGTEXT';
    }
    return 'LONGTEXT';
}

function generateSqlDump() {
    console.log(`Reading JSON files from: ${dbExportDir}`);
    const files = fs.readdirSync(dbExportDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

    let sql = `-- MySQL Dump for Construction SaaS (Importable in XAMPP / phpMyAdmin)
-- Generated automatically from Database Export
-- Date: ${new Date().toISOString()}

SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

CREATE DATABASE IF NOT EXISTS \`construction_saas\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE \`construction_saas\`;

`;

    for (const file of files) {
        const colName = sanitizeName(path.basename(file, '.json'));
        const filePath = path.join(dbExportDir, file);
        const docs = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (!Array.isArray(docs)) continue;

        console.log(`Processing ${colName} (${docs.length} rows)...`);

        // Discover all field names and infer column types
        const colTypes = new Map();
        // Ensure _id or id is first if present
        for (const doc of docs) {
            for (const key of Object.keys(doc)) {
                const sKey = sanitizeName(key);
                const currentType = colTypes.get(sKey);
                const inferred = inferType(doc[key]);
                if (!currentType) {
                    colTypes.set(sKey, inferred);
                } else if (currentType !== 'LONGTEXT' && inferred === 'LONGTEXT') {
                    colTypes.set(sKey, 'LONGTEXT');
                }
            }
        }

        if (colTypes.size === 0) {
            colTypes.set('id', 'VARCHAR(64)');
        }

        const colsArray = Array.from(colTypes.keys());

        // Create table definition
        sql += `\n-- --------------------------------------------------------\n`;
        sql += `-- Table structure for table \`${colName}\`\n`;
        sql += `-- --------------------------------------------------------\n`;
        sql += `DROP TABLE IF EXISTS \`${colName}\`;\n`;
        sql += `CREATE TABLE \`${colName}\` (\n`;
        const colDefs = colsArray.map((c, idx) => {
            const isId = (c === '_id' || c === 'id') && idx === 0;
            const def = `  \`${c}\` ${colTypes.get(c)} NULL`;
            return def;
        });
        sql += colDefs.join(',\n');
        sql += `\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`;

        // Inserts in batches
        if (docs.length > 0) {
            sql += `-- Dumping data for table \`${colName}\`\n`;
            const batchSize = 100;
            for (let i = 0; i < docs.length; i += batchSize) {
                const batch = docs.slice(i, i + batchSize);
                const valueRows = batch.map(doc => {
                    const vals = colsArray.map(c => {
                        return escapeSqlVal(doc[c]);
                    });
                    return `(${vals.join(', ')})`;
                });

                sql += `INSERT INTO \`${colName}\` (\`${colsArray.join('`, `')}\`) VALUES\n`;
                sql += valueRows.join(',\n') + ';\n';
            }
        }
    }

    sql += `\nCOMMIT;\nSET FOREIGN_KEY_CHECKS=1;\n`;

    fs.writeFileSync(outputSqlFile, sql, 'utf-8');
    const stats = fs.statSync(outputSqlFile);
    console.log(`\nSuccessfully created MySQL SQL Dump: ${outputSqlFile} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

generateSqlDump();
