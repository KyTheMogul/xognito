import * as admin from 'firebase-admin';
import { decayOldMemories } from './memory-decay';

admin.initializeApp();

export {
  decayOldMemories,
}; 