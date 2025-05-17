import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  doc, 
  arrayUnion, 
  arrayRemove,
  getDoc
} from 'firebase/firestore';

interface GroupRequest {
  id: string;
  groupId: string;
  groupName: string;
  userId: string;
  userEmail: string;
  createdAt: any;
  status: 'pending' | 'accepted' | 'rejected';
}

export default function GroupRequestNotification() {
  const [requests, setRequests] = useState<GroupRequest[]>([]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    // Listen for group requests where user is the host
    const q = query(
      collection(db, 'notifications'),
      where('type', '==', 'group_request'),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newRequests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as GroupRequest[];
      setRequests(newRequests);
    });

    return () => unsubscribe();
  }, []);

  const handleRequest = async (requestId: string, groupId: string, userId: string, action: 'accept' | 'reject') => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Update notification status
      await updateDoc(doc(db, 'notifications', requestId), {
        status: action === 'accept' ? 'accepted' : 'rejected'
      });

      if (action === 'accept') {
        // Add user to group members
        await updateDoc(doc(db, 'groups', groupId), {
          members: arrayUnion(userId)
        });

        // Add group to user's groups
        await updateDoc(doc(db, 'users', userId, 'groups', groupId), {
          joinedAt: new Date()
        });
      } else {
        // Check if user has been rejected 3 times
        const groupRef = doc(db, 'groups', groupId);
        const groupDoc = await getDoc(groupRef);
        if (groupDoc.exists()) {
          const groupData = groupDoc.data();
          const rejections = groupData.rejections || {};
          rejections[userId] = (rejections[userId] || 0) + 1;

          if (rejections[userId] >= 3) {
            // Block user after 3 rejections
            await updateDoc(groupRef, {
              blockedUsers: arrayUnion(userId)
            });
          } else {
            // Update rejection count
            await updateDoc(groupRef, {
              rejections
            });
          }
        }
      }
    } catch (error) {
      console.error('Error handling group request:', error);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {requests.map((request) => (
        <div
          key={request.id}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 shadow-lg max-w-sm animate-fade-in"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-white font-semibold">Group Join Request</h3>
              <p className="text-zinc-400 text-sm mt-1">
                {request.userEmail} wants to join {request.groupName}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleRequest(request.id, request.groupId, request.userId, 'accept')}
                className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => handleRequest(request.id, request.groupId, request.userId, 'reject')}
                className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
} 