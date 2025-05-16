import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface MemoryNotificationProps {
  memory: {
    id: string;
    summary: string;
    type: 'short' | 'relationship' | 'deep';
  };
  onDelete: () => void;
  index: number;
}

export default function MemoryNotification({ memory, onDelete, index }: MemoryNotificationProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState(memory.summary);
  const [isHovered, setIsHovered] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(error => {
        console.log('Audio playback failed:', error);
      });
    }

    const timer = setTimeout(() => {
      if (!isEditing) {
        setIsVisible(false);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [isEditing]);

  const handleSave = async () => {
    try {
      const memoryRef = doc(db, 'memory', memory.id);
      await updateDoc(memoryRef, {
        summary: editedSummary,
      });
      setIsEditing(false);
      setTimeout(() => setIsVisible(false), 2000);
    } catch (error) {
      console.error('Error updating memory:', error);
    }
  };

  const handleDelete = async () => {
    try {
      const memoryRef = doc(db, 'memory', memory.id);
      await deleteDoc(memoryRef);
      onDelete();
    } catch (error) {
      console.error('Error deleting memory:', error);
    }
  };

  // Get icon based on memory type
  const getMemoryIcon = () => {
    return (
      <img 
        src="/brain.png" 
        alt="Brain" 
        className="w-5 h-5 object-contain"
      />
    );
  };

  return (
    <>
      <audio ref={audioRef} src="/memory sound effect.mp3" preload="auto" />
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isHovered ? 1 : 0.8, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="fixed top-20 left-4 z-50 w-80 bg-black/40 backdrop-blur-sm rounded-lg p-4 border border-white/20 shadow-[inset_0_0_20px_rgba(255,255,255,0.1)]"
            style={{ transform: `translateY(${index * 120}px)` }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-300">{getMemoryIcon()}</span>
                  <span className="text-sm font-medium text-zinc-300">
                    {memory.type === 'short' ? 'New Memory' : 'Memory Updated'}
                  </span>
                </div>
                <span className="text-xs text-zinc-400">
                  {memory.type}
                </span>
              </div>

              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={editedSummary}
                    onChange={(e) => setEditedSummary(e.target.value)}
                    maxLength={300}
                    className="w-full p-2 text-sm border border-white/20 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-black/40 text-white placeholder:text-zinc-400"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className="px-3 py-1 text-sm text-black bg-white rounded-md hover:bg-zinc-100 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleDelete}
                      className="px-3 py-1 text-sm text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setIsEditing(true)}
                  className="cursor-pointer"
                >
                  <p className="text-sm text-zinc-300 line-clamp-3">
                    {memory.summary}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
} 