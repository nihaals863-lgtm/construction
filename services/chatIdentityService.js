/**
 * Chat Identity Resolution Service
 * 
 * Provides centralized, backend-authoritative identity and role resolution
 * across chat directory searching, recipient resolution, and direct messaging.
 * 
 * Enforces strict company boundaries and ensures:
 * 1. One physical person appears exactly once in the Chat Directory.
 * 2. Separate legitimate users remain completely distinct.
 * 3. Canonical account's authorized role (e.g. PM) and email are authoritatively preserved.
 * 4. Zero privilege escalation (PM does not receive COMPANY_OWNER permissions).
 * 5. Direct messaging always routes to the canonical account with full history preservation.
 */

// Verified Duplicate Clusters Configuration
// Scoped strictly by companyId to preserve multi-tenant boundary isolation.
const VERIFIED_DUPLICATE_CLUSTERS = [
    {
        companyId: '69943f0fe2e8450ab883bdfb', // Company: Jay
        canonicalUserId: '69cda4ad4a2742699702e4c6', // Raj (PM - raj@steelage.ca, active with 214 messages)
        aliasUserIds: [
            '6a5b33f89845db87c7a92641', // Historical duplicate (raj@steelage, 0 msgs)
            '6aae432ece4d83703ab0c45f'  // Historical duplicate (raj@steelage ca, 0 msgs)
        ]
    }
];

// Pre-index for O(1) lookup
const aliasToCanonicalMap = new Map();
const canonicalToClusterMap = new Map();

for (const cluster of VERIFIED_DUPLICATE_CLUSTERS) {
    const compStr = String(cluster.companyId);
    const canonStr = String(cluster.canonicalUserId);

    if (!canonicalToClusterMap.has(compStr)) {
        canonicalToClusterMap.set(compStr, new Map());
    }
    canonicalToClusterMap.get(compStr).set(canonStr, [canonStr, ...cluster.aliasUserIds.map(String)]);

    if (!aliasToCanonicalMap.has(compStr)) {
        aliasToCanonicalMap.set(compStr, new Map());
    }
    for (const aliasId of cluster.aliasUserIds) {
        aliasToCanonicalMap.get(compStr).set(String(aliasId), canonStr);
    }
}

/**
 * Resolves any user ID within a company to its authoritative canonical user ID.
 * If the user is not part of a duplicate cluster, returns the original user ID.
 *
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} companyId
 * @returns {string} canonicalUserId
 */
function resolveCanonicalUserId(userId, companyId) {
    if (!userId) return '';
    const uStr = String(userId);
    const cStr = companyId ? String(companyId) : '';

    if (cStr && aliasToCanonicalMap.has(cStr)) {
        const canonical = aliasToCanonicalMap.get(cStr).get(uStr);
        if (canonical) return canonical;
    }

    // Also check global fallback across registered clusters if companyId wasn't passed
    if (!cStr) {
        for (const compMap of aliasToCanonicalMap.values()) {
            const canonical = compMap.get(uStr);
            if (canonical) return canonical;
        }
    }

    return uStr;
}

/**
 * Returns all user IDs (canonical + aliases) belonging to a verified cluster.
 *
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} companyId
 * @returns {string[]} array of user ID strings
 */
function getClusterUserIds(userId, companyId) {
    if (!userId) return [];
    const canonId = resolveCanonicalUserId(userId, companyId);
    const cStr = companyId ? String(companyId) : '';

    if (cStr && canonicalToClusterMap.has(cStr)) {
        const cluster = canonicalToClusterMap.get(cStr).get(canonId);
        if (cluster) return cluster;
    }

    for (const compMap of canonicalToClusterMap.values()) {
        const cluster = compMap.get(canonId);
        if (cluster) return cluster;
    }

    return [canonId];
}

/**
 * Checks whether an ID is an alias (non-canonical duplicate) within a company.
 *
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} companyId
 * @returns {boolean}
 */
function isAliasUser(userId, companyId) {
    if (!userId) return false;
    const uStr = String(userId);
    const cStr = companyId ? String(companyId) : '';

    if (cStr && aliasToCanonicalMap.has(cStr)) {
        return aliasToCanonicalMap.get(cStr).has(uStr);
    }

    for (const compMap of aliasToCanonicalMap.values()) {
        if (compMap.has(uStr)) return true;
    }

    return false;
}

/**
 * Resolves a list of directory candidate contacts into canonical directory entries.
 * Enforces:
 * - One card per physical person.
 * - Authoritative display of the canonical account's authorized role and email.
 * - Never combines permissions or mutates user data.
 * - Distinct legitimate accounts are strictly preserved.
 *
 * @param {Array<Object>} users - List of user objects
 * @param {string|ObjectId} companyId - Context company ID
 * @returns {Array<Object>} Canonical deduplicated user list
 */
function resolveCanonicalContacts(users, companyId) {
    if (!Array.isArray(users)) return [];

    const cStr = companyId ? String(companyId) : '';
    const seenCanonicalIds = new Set();
    const result = [];

    // First pass: Index canonical accounts present in the candidates
    const userById = new Map();
    for (const u of users) {
        if (!u) continue;
        const uid = String(u._id || u.id || '');
        if (uid) userById.set(uid, u);
    }

    for (const u of users) {
        if (!u) continue;
        const rawId = String(u._id || u.id || '');
        if (!rawId) continue;

        const canonId = resolveCanonicalUserId(rawId, cStr || u.companyId);

        // If this canonical ID has already been added, skip duplicate
        if (seenCanonicalIds.has(canonId)) {
            continue;
        }

        seenCanonicalIds.add(canonId);

        // Always favor the canonical account document if present in candidates
        const canonicalUserDoc = userById.get(canonId) || u;

        result.push({
            ...canonicalUserDoc,
            _id: canonId,
            id: canonId,
            fullName: canonicalUserDoc.fullName || u.fullName || 'User',
            email: canonicalUserDoc.email || u.email || '',
            role: canonicalUserDoc.role || u.role || 'WORKER',
            avatar: canonicalUserDoc.avatar || u.avatar || null,
            phone: canonicalUserDoc.phone || u.phone || null,
            sharedProjects: canonicalUserDoc.sharedProjects || u.sharedProjects || [],
            isOnline: Boolean(canonicalUserDoc.isOnline || u.isOnline)
        });
    }

    return result;
}

module.exports = {
    VERIFIED_DUPLICATE_CLUSTERS,
    resolveCanonicalUserId,
    getClusterUserIds,
    isAliasUser,
    resolveCanonicalContacts
};
