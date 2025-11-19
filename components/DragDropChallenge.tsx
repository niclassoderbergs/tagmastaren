
import React, { useState, useEffect } from 'react';
import { DragDropConfig } from '../types';

interface DragDropChallengeProps {
  config: DragDropConfig;
  onComplete: (success: boolean) => void;
}

export const DragDropChallenge: React.FC<DragDropChallengeProps> = ({ config, onComplete }) => {
  // We track how many items are currently "loaded" onto the train
  const [loadedCount, setLoadedCount] = useState(0);
  // We visualize items as objects with an ID and a state (loaded or on_platform)
  const [items, setItems] = useState<{ id: number, isLoaded: boolean }[]>([]);

  useEffect(() => {
    // Initialize items
    const newItems = Array.from({ length: config.totalItems }, (_, i) => ({
      id: i,
      isLoaded: false
    }));
    setItems(newItems);
    setLoadedCount(0);
  }, [config]);

  const toggleItem = (id: number) => {
    setItems(prev => {
      const newItems = prev.map(item => {
        if (item.id === id) {
          return { ...item, isLoaded: !item.isLoaded };
        }
        return item;
      });
      
      const count = newItems.filter(i => i.isLoaded).length;
      setLoadedCount(count);
      return newItems;
    });
  };

  const checkAnswer = () => {
    if (loadedCount === config.targetCount) {
      onComplete(true);
    } else {
      onComplete(false);
    }
  };

  // Determine theme colors based on container name (Bistro vs Train)
  const isBistro = config.containerName.includes('BORD') || config.containerName.includes('BISTRO');
  
  const targetBgClass = isBistro ? 'bg-amber-100 border-amber-800' : 'bg-red-100 border-red-800';
  const targetBorderClass = isBistro ? 'border-amber-200' : 'border-red-200';
  const targetTextClass = isBistro ? 'text-amber-900' : 'text-red-900';

  // Fallback for legacy configs if sourceName/verb missing
  const displaySource = config.sourceName || 'LASTKAJEN';
  const displayVerb = config.verb || 'LASTA PÅ';

  return (
    <div className="w-full flex flex-col gap-6 select-none uppercase">
      {/* Instructional Status */}
      <div className="bg-blue-50 p-4 rounded-2xl border-2 border-blue-200 text-center flex flex-col items-center justify-center">
        <p className="text-sm font-bold text-blue-800 mb-1 tracking-wider">DITT UPPDRAG</p>
        <div className="flex items-center gap-3 bg-white px-6 py-2 rounded-full shadow-sm border border-blue-100">
          <span className="text-xl font-bold text-slate-600">{displayVerb}:</span>
          <span className="text-4xl font-black text-blue-600">{config.targetCount}</span>
          <span className="text-3xl">{config.itemEmoji}</span>
        </div>
      </div>

      <div className="relative min-h-[300px] flex flex-col md:flex-row gap-4">
        
        {/* SOURCE AREA (Platform/Kitchen) */}
        <div className="flex-1 bg-slate-200 rounded-xl p-4 border-b-8 border-slate-300 flex flex-wrap content-start gap-2 min-h-[150px]">
          <div className="w-full text-center text-slate-500 font-bold text-sm mb-2 border-b border-slate-300 pb-1">
            {displaySource}
          </div>
          {items.filter(i => !i.isLoaded).map(item => (
            <button
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className="w-16 h-16 bg-white rounded-lg shadow-md border-2 border-slate-200 text-4xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer"
              aria-label={`Flytta ${config.itemEmoji}`}
            >
              {config.itemEmoji}
            </button>
          ))}
        </div>

        {/* ARROW VISUAL */}
        <div className="flex items-center justify-center md:rotate-0 rotate-90">
          <div className="text-4xl text-slate-300">➡</div>
        </div>

        {/* TARGET AREA (Train Car/Table) */}
        <div className={`flex-1 rounded-xl p-4 border-b-8 relative overflow-hidden min-h-[150px] ${targetBgClass}`}>
          
          {/* Only show wheels if it is NOT a bistro table */}
          {!isBistro && (
            <>
              <div className="absolute -bottom-6 left-4 w-12 h-12 bg-slate-800 rounded-full border-4 border-slate-600"></div>
              <div className="absolute -bottom-6 right-4 w-12 h-12 bg-slate-800 rounded-full border-4 border-slate-600"></div>
            </>
          )}
          
          <div className={`w-full text-center font-bold text-sm mb-2 border-b pb-1 ${targetTextClass} ${targetBorderClass}`}>
            {config.containerName}
          </div>
          
          <div className="flex flex-wrap content-start gap-2 relative z-10">
            {items.filter(i => i.isLoaded).map(item => (
              <button
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className={`w-16 h-16 bg-white/80 rounded-lg shadow-sm border-2 text-4xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer animate-bounce-in ${targetBorderClass}`}
                aria-label={`Flytta tillbaka ${config.itemEmoji}`}
              >
                {config.itemEmoji}
              </button>
            ))}
          </div>
        </div>

      </div>

      <div className="flex justify-center mt-4">
        <button
          onClick={checkAnswer}
          className="bg-green-500 hover:bg-green-600 text-white text-2xl font-bold py-4 px-12 rounded-full shadow-xl border-b-4 border-green-700 active:border-b-0 active:translate-y-1 transition-all uppercase"
        >
          JAG ÄR KLAR! 👍
        </button>
      </div>
    </div>
  );
};
