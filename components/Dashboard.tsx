import { useState } from 'react';
import MemoryNotification from './MemoryNotification';

interface Memory {
  id: string;
  summary: string;
  type: 'short' | 'relationship' | 'deep';
}

export default function Dashboard() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeMemories, setActiveMemories] = useState<Memory[]>([]);

  const handleNewMemory = (memory: Memory) => {
    setActiveMemories(prev => [...prev, memory]);
  };

  const handleMemoryDelete = (memoryId: string) => {
    setActiveMemories(prev => prev.filter(m => m.id !== memoryId));
  };

  // Test function to simulate memory creation
  const testMemoryCreation = () => {
    handleNewMemory({
      id: 'test-' + Date.now(),
      summary: 'This is a test memory to verify the notification system is working correctly.',
      type: 'short'
    });
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <div className={`fixed inset-y-0 left-0 z-30 w-64 bg-white shadow-lg transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out`}>
        {/* ... existing sidebar content ... */}
      </div>

      <div className="flex-1 ml-0 transition-all duration-300 ease-in-out">
        {/* Test button */}
        <button
          onClick={testMemoryCreation}
          className="fixed top-4 right-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
        >
          Test Memory Notification
        </button>
        {/* ... existing main content ... */}
      </div>

      {activeMemories.map((memory, index) => (
        <MemoryNotification
          key={memory.id}
          memory={memory}
          onDelete={() => handleMemoryDelete(memory.id)}
          index={index}
        />
      ))}
    </div>
  );
} 