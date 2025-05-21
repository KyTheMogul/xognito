import { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';

interface GroupRequest {
  id: string;
  type: 'group_request';
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
      const newRequests: GroupRequest[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data() as GroupRequest;
        // Only show requests for groups where user is host
        if (data.userId !== user.uid) {
          newRequests.push({ ...data, id: doc.id });
        }
      });
      setRequests(newRequests);
    });

    return () => unsubscribe();
  }, []);

  const handleRequest = async (requestId: string, groupId: string, userId: string, accept: boolean) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Update notification status
      await updateDoc(doc(db, 'notifications', requestId), {
        status: accept ? 'accepted' : 'rejected'
      });

      // Update group members or blocked users
      const groupRef = doc(db, 'groups', groupId);
      if (accept) {
        await updateDoc(groupRef, {
          members: arrayUnion(userId),
          pendingRequests: arrayRemove(userId)
        });
      } else {
        // Check if user has been rejected 3 times
        const groupDoc = await getDoc(groupRef);
        const groupData = groupDoc.data();
        const rejections = groupData?.rejections?.[userId] || 0;
        
        if (rejections >= 2) {
          // Add to blocked users on third rejection
          await updateDoc(groupRef, {
            blockedUsers: arrayUnion(userId),
            pendingRequests: arrayRemove(userId),
            rejections: {
              ...groupData?.rejections,
              [userId]: rejections + 1
            }
          });
        } else {
          // Just increment rejection count
          await updateDoc(groupRef, {
            pendingRequests: arrayRemove(userId),
            rejections: {
              ...groupData?.rejections,
              [userId]: rejections + 1
            }
          });
        }
      }
    } catch (error) {
      console.error('Error handling group request:', error);
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-50 flex flex-col gap-2">
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
                onClick={() => handleRequest(request.id, request.groupId, request.userId, true)}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() => handleRequest(request.id, request.groupId, request.userId, false)}
                className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
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