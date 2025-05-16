"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.decayOldMemories = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
exports.decayOldMemories = functions.pubsub
    .schedule('0 0 */14 * *') // Run every 14 days
    .timeZone('UTC')
    .onRun(async (context) => {
    const db = admin.firestore();
    const batch = db.batch();
    const now = Date.now();
    let deletedCount = 0;
    try {
        // Get all users
        const usersSnapshot = await db.collection('users').get();
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const memoriesRef = db.collection(`users/${userId}/memory`);
            // Get all non-deleted memories
            const memoriesSnapshot = await memoriesRef
                .where('deleted', '==', false)
                .get();
            for (const memoryDoc of memoriesSnapshot.docs) {
                const memory = memoryDoc.data();
                const lastTriggered = memory.lastTriggered?.toDate()?.getTime() || 0;
                const age = now - lastTriggered;
                // Skip deep memories
                if (memory.type === 'deep')
                    continue;
                // Delete short memories older than 30 days
                if (memory.type === 'short' && age > THIRTY_DAYS_MS) {
                    batch.update(memoryDoc.ref, { deleted: true });
                    deletedCount++;
                    continue;
                }
                // Delete relationship memories older than 45 days if not triggered enough
                if (memory.type === 'relationship') {
                    const triggerCount = memory.triggerCount || 0;
                    if (age > FORTY_FIVE_DAYS_MS && triggerCount < 3) {
                        batch.update(memoryDoc.ref, { deleted: true });
                        deletedCount++;
                    }
                }
            }
        }
        // Commit all changes
        if (deletedCount > 0) {
            await batch.commit();
            console.log(`Successfully deleted ${deletedCount} old memories`);
        }
        else {
            console.log('No memories needed to be deleted');
        }
        return null;
    }
    catch (error) {
        console.error('Error in memory decay function:', error);
        throw error;
    }
});
//# sourceMappingURL=memory-decay.js.map