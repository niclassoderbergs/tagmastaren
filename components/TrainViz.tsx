import React, { useEffect, useRef } from 'react';
import { TrainCar } from '../types';

interface TrainVizProps {
  cars: TrainCar[];
}

// SVG Components for different car types
const Wheel = ({ cx, cy }: { cx: number, cy: number }) => (
  <g className="train-wheel origin-center" style={{ transformBox: 'fill-box' }}>
    <circle cx={cx} cy={cy} r="5" fill="#333" stroke="#111" strokeWidth="2" />
    <line x1={cx} y1={cy-5} x2={cx} y2={cy+5} stroke="#888" strokeWidth="1" />
    <line x1={cx-5} y1={cy} x2={cx+5} y2={cy} stroke="#888" strokeWidth="1" />
  </g>
);

const Locomotive = () => (
  <g className="train-bounce">
    {/* Main Body */}
    <rect x="10" y="20" width="60" height="40" rx="2" fill="#e11d48" />
    <rect x="10" y="10" width="30" height="20" fill="#e11d48" />
    <path d="M 70 20 L 90 40 L 70 40 Z" fill="#333" /> {/* Cowcatcher */}
    <rect x="45" y="25" width="20" height="15" fill="#bef264" /> {/* Window */}
    <rect x="15" y="0" width="10" height="20" fill="#333" /> {/* Chimney */}
    <circle cx="20" cy="-5" r="3" fill="rgba(255,255,255,0.5)" className="animate-ping" />
    
    <Wheel cx={25} cy={60} />
    <Wheel cx={55} cy={60} />
  </g>
);

const PassengerCar = ({ color }: { color: string }) => (
  <g className="train-bounce">
    <rect x="5" y="20" width="70" height="40" rx="2" fill={color} />
    <rect x="10" y="25" width="15" height="15" fill="#bfdbfe" />
    <rect x="30" y="25" width="15" height="15" fill="#bfdbfe" />
    <rect x="50" y="25" width="15" height="15" fill="#bfdbfe" />
    <rect x="0" y="45" width="5" height="5" fill="#333" /> {/* Link */}
    
    <Wheel cx={20} cy={60} />
    <Wheel cx={60} cy={60} />
  </g>
);

const CargoCar = ({ color }: { color: string }) => (
  <g className="train-bounce">
    <rect x="5" y="35" width="70" height="25" fill="#475569" />
    <rect x="10" y="20" width="60" height="15" fill={color} /> {/* Cargo load */}
    <line x1="10" y1="25" x2="70" y2="25" stroke="rgba(0,0,0,0.2)" strokeWidth="2" />
    
    <Wheel cx={20} cy={60} />
    <Wheel cx={60} cy={60} />
  </g>
);

const TankerCar = ({ color }: { color: string }) => (
  <g className="train-bounce">
    <rect x="5" y="50" width="70" height="10" fill="#333" />
    <rect x="10" y="20" width="60" height="30" rx="15" fill={color} />
    
    <Wheel cx={20} cy={60} />
    <Wheel cx={60} cy={60} />
  </g>
);

export const TrainViz: React.FC<TrainVizProps> = ({ cars }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the right when a new car is added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [cars.length]);

  return (
    <div className="w-full bg-slate-800 border-t-4 border-b-4 border-slate-600 relative h-48 flex items-center overflow-hidden">
      {/* Background Scenery (Static for simplicity, but implies motion) */}
      <div className="absolute top-4 left-10 w-16 h-16 bg-yellow-100 rounded-full opacity-20 blur-xl"></div>
      
      <div 
        ref={scrollRef}
        className="flex items-end pb-4 px-10 space-x-1 overflow-x-auto scroll-smooth w-full h-full no-scrollbar"
        style={{ scrollBehavior: 'smooth' }}
      >
        {/* Tracks */}
        <div className="absolute bottom-4 left-0 w-[2000px] h-2 bg-stone-400 z-0"></div>

        {/* Render Cars */}
        {cars.map((car, index) => (
          <svg key={car.id} width="80" height="80" viewBox="0 0 80 70" className="flex-shrink-0 z-10">
            {car.type === 'LOCOMOTIVE' && <Locomotive />}
            {car.type === 'PASSENGER' && <PassengerCar color={car.color} />}
            {car.type === 'CARGO' && <CargoCar color={car.color} />}
            {car.type === 'TANKER' && <TankerCar color={car.color} />}
            {car.type === 'COAL' && <CargoCar color="#000" />}
          </svg>
        ))}
      </div>
    </div>
  );
};