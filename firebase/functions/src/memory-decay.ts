import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

export const decayOldMemories = onSchedule({
  schedule: '0 0 */14 * *', // Run every 14 days
  timeZone: 'UTC',
  memory: '256MiB'
}, async () => {
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
          if (memory.type === 'deep') continue;

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
      } else {
        console.log('No memories needed to be deleted');
      }
    } catch (error) {
      console.error('Error in memory decay function:', error);
      throw error;
    }
  }); 