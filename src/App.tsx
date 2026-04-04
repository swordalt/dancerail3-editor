import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FilePlus, Upload } from 'lucide-react';
import Editor from './Editor';

export default function App() {
  const [view, setView] = useState<{page: 'landing' | 'editor', mode?: 'new' | 'import'}>({page: 'landing'});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('Selected file:', file.name);
      setView({page: 'editor', mode: 'import'});
    }
    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <AnimatePresence mode="wait">
      {view.page === 'landing' ? (
        <motion.div
          key="landing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col items-center justify-center p-6 font-sans selection:bg-indigo-500/30"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="max-w-2xl w-full flex flex-col items-center text-center space-y-12"
          >
            <div className="space-y-4">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }}
                className="inline-flex items-center justify-center p-4 bg-indigo-500/10 rounded-2xl mb-4"
              >
                <div className="w-16 h-16 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </motion.div>
              <h1 className="text-5xl font-bold tracking-tight text-white">
                DanceRail3 <span className="text-indigo-400">Editor</span>
              </h1>
              <p className="text-lg text-neutral-400 max-w-md mx-auto">
                A modern, performant chart editor for creating and modifying DanceRail3 levels.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-lg">
              <motion.button
                onClick={() => setView({page: 'editor', mode: 'new'})}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="group relative flex flex-col items-center justify-center p-8 bg-neutral-900 border border-neutral-800 rounded-2xl hover:border-indigo-500/50 hover:bg-neutral-800/50 transition-colors overflow-hidden cursor-pointer"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <FilePlus className="w-10 h-10 text-indigo-400 mb-4 group-hover:scale-110 transition-transform duration-300" />
                <span className="text-lg font-semibold text-white">New Project</span>
                <span className="text-sm text-neutral-400 mt-2">Start from scratch</span>
              </motion.button>

              <motion.button
                onClick={handleImportClick}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="group relative flex flex-col items-center justify-center p-8 bg-neutral-900 border border-neutral-800 rounded-2xl hover:border-emerald-500/50 hover:bg-neutral-800/50 transition-colors overflow-hidden cursor-pointer"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <Upload className="w-10 h-10 text-emerald-400 mb-4 group-hover:scale-110 transition-transform duration-300" />
                <span className="text-lg font-semibold text-white">Import Project</span>
                <span className="text-sm text-neutral-400 mt-2">Load existing chart</span>
              </motion.button>
              <input
                type="file"
                accept=".zip"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </motion.div>
        </motion.div>
      ) : (
        <Editor onBack={() => setView({page: 'landing'})} mode={view.mode} />
      )}
    </AnimatePresence>
  );
}
