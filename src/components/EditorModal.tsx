import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { EditorFormData } from '../types/editorTypes';

interface EditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  formData: EditorFormData;
  setFormData: (data: EditorFormData) => void;
}

export default function EditorModal({ isOpen, onClose, onConfirm, formData, setFormData }: EditorModalProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFormData({ ...formData, songFile: e.target.files[0] });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">
                New Project Details
              </h2>
              <button onClick={onClose} className="text-neutral-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <input type="text" placeholder="Song ID" value={formData.songId} className="w-full p-3 bg-neutral-800 rounded-lg border border-neutral-700 focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setFormData({...formData, songId: e.target.value})} />
              <input type="text" placeholder="Song Name" value={formData.songName} className="w-full p-3 bg-neutral-800 rounded-lg border border-neutral-700 focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setFormData({...formData, songName: e.target.value})} />
              <input type="text" placeholder="Song Artist" value={formData.songArtist} className="w-full p-3 bg-neutral-800 rounded-lg border border-neutral-700 focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setFormData({...formData, songArtist: e.target.value})} />
              <input type="number" placeholder="Song BPM" value={formData.songBpm} className="w-full p-3 bg-neutral-800 rounded-lg border border-neutral-700 focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setFormData({...formData, songBpm: e.target.value})} />
              <input type="number" placeholder="Difficulty" value={formData.difficulty} className="w-full p-3 bg-neutral-800 rounded-lg border border-neutral-700 focus:border-indigo-500 outline-none transition-colors" onChange={(e) => setFormData({...formData, difficulty: e.target.value})} />
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleUploadClick}
                  className="p-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg border border-neutral-700 transition-colors w-full text-left"
                >
                  {formData.songFile ? formData.songFile.name : 'Select Audio File'}
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="audio/*" 
                  className="hidden" 
                />
              </div>

              <button onClick={onConfirm} className="w-full p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-colors">
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
