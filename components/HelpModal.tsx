import React, { useState } from 'react';

interface ShapeCardProps {
  title: string;
  description: string;
  children?: React.ReactNode;
}

const ShapeCard = ({ title, description, children }: ShapeCardProps) => (
  <div className="flex flex-col items-center bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 shadow-sm hover:scale-105 transition-transform">
    <svg width="80" height="80" viewBox="0 0 100 100" className="mb-2 drop-shadow-md">
      {children}
    </svg>
    <span className="text-lg font-black text-slate-700 uppercase">{title}</span>
    <span className="text-[10px] font-bold text-slate-400 uppercase text-center mt-1 leading-tight">{description}</span>
  </div>
);

const ColorCard = ({ color, name }: { color: string, name: string }) => (
  <div className="flex flex-col items-center bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 shadow-sm hover:scale-105 transition-transform">
    <div className={`w-16 h-16 rounded-full shadow-inner mb-3 ${color}`}></div>
    <span className="text-lg font-black text-slate-700 uppercase">{name}</span>
  </div>
);

const NumberCard = ({ num }: { num: number }) => (
  <div className="flex flex-col items-center bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 shadow-sm hover:scale-105 transition-transform aspect-square justify-center">
    <span className="text-6xl font-black text-blue-600 drop-shadow-sm">{num}</span>
  </div>
);

const LetterCard = ({ char }: { char: string }) => (
  <div className="flex flex-col items-center bg-slate-50 p-3 rounded-xl border-2 border-slate-100 shadow-sm hover:scale-105 transition-transform">
    <div className="flex items-baseline gap-2">
      <span className="text-4xl font-black text-slate-800">{char}</span>
      <span className="text-3xl font-bold text-slate-400">{char.toLowerCase()}</span>
    </div>
  </div>
);

interface HelpModalProps {
  onClose: () => void;
}

type HelpTab = 'SHAPES' | 'COLORS' | 'NUMBERS' | 'LETTERS';

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<HelpTab>('SHAPES');

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ".split('');
  const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto animate-fade-in">
      <div className="flex min-h-full items-center justify-center p-2 md:p-4">
        <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border-4 border-indigo-300 flex flex-col relative my-4 md:my-8 min-h-[60vh]">
          
          {/* Header */}
          <div className="bg-indigo-100 p-4 flex justify-between items-center border-b-4 border-indigo-200 rounded-t-3xl sticky top-0 z-10">
            <h2 className="text-xl md:text-2xl font-black text-indigo-900 uppercase flex items-center gap-2">
              🛟 HJÄLPCENTRALEN
            </h2>
            <button 
              onClick={onClose}
              className="bg-white text-indigo-900 rounded-full p-2 hover:bg-red-100 hover:text-red-600 transition-colors border-2 border-indigo-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* Tabs - Scrollable on mobile if needed, or wrapped */}
          <div className="flex border-b-4 border-indigo-100 bg-indigo-50 overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setActiveTab('SHAPES')}
              className={`flex-1 py-3 px-2 md:py-4 font-bold text-xs md:text-lg uppercase transition-colors whitespace-nowrap ${
                activeTab === 'SHAPES' 
                  ? 'bg-white text-indigo-800 border-b-4 border-indigo-500 -mb-1' 
                  : 'text-slate-400 hover:bg-indigo-100'
              }`}
            >
              🔶 FORMER
            </button>
            <button 
              onClick={() => setActiveTab('COLORS')}
              className={`flex-1 py-3 px-2 md:py-4 font-bold text-xs md:text-lg uppercase transition-colors whitespace-nowrap ${
                activeTab === 'COLORS' 
                  ? 'bg-white text-indigo-800 border-b-4 border-indigo-500 -mb-1' 
                  : 'text-slate-400 hover:bg-indigo-100'
              }`}
            >
              🎨 FÄRGER
            </button>
            <button 
              onClick={() => setActiveTab('NUMBERS')}
              className={`flex-1 py-3 px-2 md:py-4 font-bold text-xs md:text-lg uppercase transition-colors whitespace-nowrap ${
                activeTab === 'NUMBERS' 
                  ? 'bg-white text-indigo-800 border-b-4 border-indigo-500 -mb-1' 
                  : 'text-slate-400 hover:bg-indigo-100'
              }`}
            >
              🔢 SIFFROR
            </button>
            <button 
              onClick={() => setActiveTab('LETTERS')}
              className={`flex-1 py-3 px-2 md:py-4 font-bold text-xs md:text-lg uppercase transition-colors whitespace-nowrap ${
                activeTab === 'LETTERS' 
                  ? 'bg-white text-indigo-800 border-b-4 border-indigo-500 -mb-1' 
                  : 'text-slate-400 hover:bg-indigo-100'
              }`}
            >
              🅰️ BOKSTÄVER
            </button>
          </div>

          {/* Content */}
          <div className="p-4 md:p-6 bg-white rounded-b-3xl overflow-y-auto max-h-[60vh]">
            
            {activeTab === 'SHAPES' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ShapeCard title="KVADRAT" description="4 LIKA LÅNGA SIDOR">
                  <rect x="20" y="20" width="60" height="60" fill="#3b82f6" stroke="#1e3a8a" strokeWidth="3" />
                </ShapeCard>
                
                <ShapeCard title="REKTANGEL" description="2 KORTA & 2 LÅNGA">
                  <rect x="10" y="30" width="80" height="40" fill="#ef4444" stroke="#7f1d1d" strokeWidth="3" />
                </ShapeCard>

                <ShapeCard title="CIRKEL" description="RUND UTAN HÖRN">
                  <circle cx="50" cy="50" r="35" fill="#eab308" stroke="#713f12" strokeWidth="3" />
                </ShapeCard>

                <ShapeCard title="TRIANGEL" description="3 SIDOR & 3 HÖRN">
                  <path d="M 50 15 L 85 80 L 15 80 Z" fill="#22c55e" stroke="#14532d" strokeWidth="3" />
                </ShapeCard>
                
                <ShapeCard title="OVAL" description="SOM ETT ÄGG">
                  <ellipse cx="50" cy="50" rx="35" ry="25" fill="#a855f7" stroke="#581c87" strokeWidth="3" />
                </ShapeCard>

                <ShapeCard title="STJÄRNA" description="5 UDDA SPETSAR">
                  <path d="M 50 15 L 61 38 L 86 42 L 68 60 L 72 85 L 50 73 L 28 85 L 32 60 L 14 42 L 39 38 Z" fill="#f97316" stroke="#c2410c" strokeWidth="3" />
                </ShapeCard>
              </div>
            )}

            {activeTab === 'COLORS' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ColorCard color="bg-red-500" name="RÖD" />
                <ColorCard color="bg-blue-500" name="BLÅ" />
                <ColorCard color="bg-green-500" name="GRÖN" />
                <ColorCard color="bg-yellow-400" name="GUL" />
                <ColorCard color="bg-orange-500" name="ORANGE" />
                <ColorCard color="bg-purple-500" name="LILA" />
                <ColorCard color="bg-pink-400" name="ROSA" />
                <ColorCard color="bg-black" name="SVART" />
                <ColorCard color="bg-white border-2 border-slate-200" name="VIT" />
                <ColorCard color="bg-stone-500" name="GRÅ" />
                <ColorCard color="bg-amber-800" name="BRUN" />
                <ColorCard color="bg-teal-400" name="TURKOS" />
              </div>
            )}

            {activeTab === 'NUMBERS' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                {numbers.map(num => (
                  <NumberCard key={num} num={num} />
                ))}
              </div>
            )}

            {activeTab === 'LETTERS' && (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {alphabet.map(char => (
                  <LetterCard key={char} char={char} />
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};