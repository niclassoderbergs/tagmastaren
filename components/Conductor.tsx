import React from 'react';

interface ConductorProps {
  message: string;
  mood: 'happy' | 'waiting' | 'thinking' | 'excited';
}

export const Conductor: React.FC<ConductorProps> = ({ message, mood }) => {
  
  return (
    <div className="flex items-start gap-4 bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-lg border-2 border-blue-200 max-w-2xl mx-auto transition-all duration-300">
      <div className="relative">
        {/* Always show the Conductor as the main avatar */}
        <div className="text-5xl bg-blue-100 p-2 rounded-full border-2 border-blue-300 flex-shrink-0 shadow-inner">
          👨‍✈️
        </div>
        
        {/* Status Overlays */}
        {mood === 'thinking' && (
          <div className="absolute -top-1 -right-1 text-3xl animate-pulse filter drop-shadow-md">
            💭
          </div>
        )}
        {mood === 'excited' && (
           <div className="absolute -top-1 -right-1 text-3xl animate-bounce filter drop-shadow-md">
            🌟
          </div>
        )}
        {mood === 'waiting' && (
           <div className="absolute -bottom-1 -right-1 text-2xl animate-pulse">
            ⏳
          </div>
        )}
      </div>
      
      <div className="flex flex-col justify-center h-full py-1">
        <h3 className="font-bold text-blue-900 text-sm uppercase tracking-wider mb-1">Konduktören säger:</h3>
        <p className="text-lg font-medium text-slate-700 leading-tight">
          {message}
        </p>
      </div>
    </div>
  );
};