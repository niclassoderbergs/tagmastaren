import React, { useState, useEffect, useRef } from 'react';
import { Subject, Question, TrainCar, GameState, AppSettings, QuestionType } from './types';
import { generateQuestion, generateRewardImage, playTextAsSpeech, markQuestionTooHard, removeBadImage } from './services/geminiService';
import { TrainViz } from './components/TrainViz';
import { Conductor } from './components/Conductor';
import { SettingsModal } from './components/SettingsModal';
import { DragDropChallenge } from './components/DragDropChallenge';
import { HelpModal } from './components/HelpModal';

// Visual assets (simple colors for cars)
const CAR_COLORS = ['#fca5a5', '#86efac', '#93c5fd', '#fde047', '#c4b5fd', '#fdba74'];
const MISSION_TARGET = 5; // Number of correct answers needed to get a car
const BUFFER_TARGET_SIZE = 5; // How many questions we want ready in the background

interface LayoutProps {
  children: React.ReactNode;
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, settings, setSettings, showSettings, setShowSettings }) => (
  <div className={`min-h-screen flex flex-col bg-slate-50 ${settings.useUppercase ? 'uppercase' : ''}`}>
     {children}
     {showSettings && (
      <SettingsModal 
        settings={settings} 
        onUpdateSettings={setSettings} 
        onClose={() => setShowSettings(false)} 
      />
     )}
  </div>
);

const DEFAULT_SETTINGS: AppSettings = {
  useUppercase: true,
  useDigits: true, // Default to using digits (1, 2, 3) instead of words
  subjectDifficulty: {
    [Subject.MATH]: 1, 
    [Subject.LANGUAGE]: 2,
    [Subject.LOGIC]: 2,
    [Subject.PHYSICS]: 2
  },
  enableBannedTopics: true,
  bannedTopics: [
    "Hjulet", 
    "Is/Vatten", 
    "Vad växter behöver", 
    "Hjärtat/Blod", 
    "Solen",
    "Fotosyntes"
  ]
};

const INITIAL_GAME_STATE: GameState = {
  score: 0,
  cars: [{ id: 'loco', type: 'LOCOMOTIVE', color: 'red' }], // Start with just the engine
  currentStreak: 0,
};

const MissionProgress = ({ current, target, compact }: { current: number, target: number, compact: boolean }) => (
  <div className={`flex items-center gap-2 justify-center bg-blue-50 rounded-full border border-blue-100 mx-auto w-fit transition-all ${compact ? 'py-1 px-3 mb-2' : 'py-3 px-6 mb-4'}`}>
    <span className={`text-blue-800 font-bold mr-2 ${compact ? 'text-xs' : 'text-sm'}`}>UPPDRAG:</span>
    <div className="flex gap-2">
      {Array.from({ length: target }).map((_, i) => (
        <div 
          key={i}
          className={`rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
            i < current 
              ? 'bg-yellow-400 border-yellow-500 scale-110 shadow-md' 
              : 'bg-white border-slate-300'
          } ${compact ? 'w-6 h-6' : 'w-8 h-8'}`}
        >
          {i < current && <span className={`text-yellow-900 ${compact ? 'text-sm' : 'text-lg'}`}>★</span>}
        </div>
      ))}
    </div>
  </div>
);

export default function App() {
  // Initialize GameState from LocalStorage if available
  const [gameState, setGameState] = useState<GameState>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('trainMasterState');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error("Failed to parse saved game state");
        }
      }
    }
    return INITIAL_GAME_STATE;
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('trainMasterSettings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { 
        ...DEFAULT_SETTINGS, 
        ...DEFAULT_SETTINGS, 
        ...parsed, 
        subjectDifficulty: { ...DEFAULT_SETTINGS.subjectDifficulty, ...parsed.subjectDifficulty },
        // Ensure new fields exist if loading old settings
        bannedTopics: parsed.bannedTopics || DEFAULT_SETTINGS.bannedTopics,
        enableBannedTopics: parsed.enableBannedTopics ?? DEFAULT_SETTINGS.enableBannedTopics
      };
    }
    return DEFAULT_SETTINGS;
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  // Question States
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [selectedAnswerIndex, setSelectedAnswerIndex] = useState<number | null>(null);
  
  // QUEUE SYSTEM
  const [questionBuffer, setQuestionBuffer] = useState<Question[]>([]);
  const fetchingCountRef = useRef(0); // Tracks active API calls to prevent over-fetching
  
  // DRAG DROP FREQUENCY CONTROL
  const [hasDragDropOccurred, setHasDragDropOccurred] = useState(false);

  const [loading, setLoading] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | null, msg: string }>({ type: null, msg: "" });
  const [showExplanation, setShowExplanation] = useState(false);
  const [missionProgress, setMissionProgress] = useState(0);
  
  // Reward Image States
  const [preloadedRewardImage, setPreloadedRewardImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  
  // Audio State
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Determine if we are in active gameplay to condense the UI
  const isMissionActive = !!selectedSubject;

  // Persist Settings
  useEffect(() => {
    localStorage.setItem('trainMasterSettings', JSON.stringify(settings));
  }, [settings]);

  // Persist Game State (Train & Score)
  useEffect(() => {
    localStorage.setItem('trainMasterState', JSON.stringify(gameState));
  }, [gameState]);

  // --- BUFFER MANAGEMENT ---

  // Ensures the buffer always has BUFFER_TARGET_SIZE items
  const ensureBufferFilled = async (subject: Subject) => {
    // Calculate how many we need
    const currentBufferSize = questionBuffer.length;
    const inflight = fetchingCountRef.current;
    const needed = BUFFER_TARGET_SIZE - (currentBufferSize + inflight);

    if (needed <= 0) return;

    // Determine the "previous type" for variety logic.
    let lastTypeInChain: QuestionType | undefined = currentQuestion?.type;
    if (questionBuffer.length > 0) {
      lastTypeInChain = questionBuffer[questionBuffer.length - 1].type;
    }

    // Launch 'needed' number of fetch operations
    for (let i = 0; i < needed; i++) {
      fetchingCountRef.current += 1;
      fetchSingleBufferItem(subject, lastTypeInChain).then(() => {
        fetchingCountRef.current -= 1;
      });
    }
  };

  const fetchSingleBufferItem = async (subject: Subject, previousType?: QuestionType) => {
    try {
      const difficulty = settings.subjectDifficulty[subject];
      const carCount = gameState.cars.length;
      
      // Pass settings.bannedTopics if enabled
      const banList = settings.enableBannedTopics ? settings.bannedTopics : [];
      
      // Check if we should allow DnD generation
      // We check the state `hasDragDropOccurred`. If true, strictly NO DnD.
      // We also check if the buffer *already* has one.
      const bufferHasDragDrop = questionBuffer.some(q => q.type === 'DRAG_AND_DROP');
      const allowDragDrop = !hasDragDropOccurred && !bufferHasDragDrop;

      const question = await generateQuestion(subject, difficulty, settings.useDigits, carCount, previousType, banList, allowDragDrop);
      
      // Add to buffer immediately (without image)
      setQuestionBuffer(prev => [...prev, question]);

      // Start Image Generation for this question if needed
      if (question.visualSubject) {
        generateRewardImage(question.visualSubject).then(url => {
          if (url) {
            // 1. Update Buffer: if the question is still in the buffer, attach image
            setQuestionBuffer(prev => 
              prev.map(q => q.id === question.id ? { ...q, preloadedImageUrl: url } : q)
            );

            // 2. Check Current: if the question became active while image was loading, update active state
            setCurrentQuestion(current => {
               if (current && current.id === question.id) {
                 setPreloadedRewardImage(url); // Ensure UI gets the signal
                 return { ...current, preloadedImageUrl: url };
               }
               return current;
            });
          }
        });
      }
    } catch (err) {
      console.error("Failed to buffer item", err);
    }
  };

  // Monitor buffer needs
  useEffect(() => {
    if (selectedSubject) {
      ensureBufferFilled(selectedSubject);
    }
  }, [selectedSubject, questionBuffer.length]);


  // --- GAME LOGIC ---

  // Effect to trigger background image generation for CURRENT question if not ready yet
  // This handles the case where the first question loads, or a fallback question triggers.
  useEffect(() => {
    let isMounted = true;
    if (currentQuestion?.visualSubject && !preloadedRewardImage && !showExplanation && !isGeneratingImage) {
      // Only trigger if we don't have it and haven't started
      console.log("Current question needs image, starting gen:", currentQuestion.visualSubject);
      generateRewardImage(currentQuestion.visualSubject).then(url => {
        if (isMounted && url) {
          setPreloadedRewardImage(url);
          setCurrentQuestion(prev => prev ? { ...prev, preloadedImageUrl: url } : prev);
        }
      });
    }
    return () => { isMounted = false; };
  }, [currentQuestion]); // dependency simplified

  const playSound = (type: 'success' | 'start' | 'click') => {
    // Placeholder
  };

  const handleSpeakQuestion = async () => {
    if (!currentQuestion || isPlayingAudio) return;
    setIsPlayingAudio(true);
    await playTextAsSpeech(currentQuestion.text);
    setIsPlayingAudio(false);
  };

  // Moves a question from Buffer to Current
  const loadNextQuestion = (subject: Subject) => {
    setFeedback({ type: null, msg: "" });
    setShowExplanation(false);
    setPreloadedRewardImage(null);
    setCurrentQuestion(null);
    setSelectedAnswerIndex(null);

    // STRICT LOGIC: Find the first valid question
    // If we have already done a DragDrop this mission (hasDragDropOccurred), 
    // we must SKIP any DnD questions in the buffer.
    
    let validNextIndex = -1;
    let isSelectedDnD = false;

    for (let i = 0; i < questionBuffer.length; i++) {
      const q = questionBuffer[i];
      
      // If we already had a DnD, any future DnD is "poison" - skip it.
      if (hasDragDropOccurred && q.type === 'DRAG_AND_DROP') {
        continue;
      }
      
      validNextIndex = i;
      isSelectedDnD = (q.type === 'DRAG_AND_DROP');
      break;
    }

    if (validNextIndex !== -1) {
      const nextQ = questionBuffer[validNextIndex];
      
      // IMPORTANT: If we picked a DnD question, we must now lock the state 
      // so no more DnD questions are generated or loaded.
      if (isSelectedDnD) {
        setHasDragDropOccurred(true);
      }

      // Construct new buffer: 
      // 1. Remove the chosen question.
      // 2. If the chosen question was DnD (or we already had one), remove ALL other DnD questions from the buffer immediately.
      const shouldPruneDnD = isSelectedDnD || hasDragDropOccurred;

      const newBuffer = questionBuffer.filter((q, idx) => {
        if (idx === validNextIndex) return false; // Remove loaded
        if (shouldPruneDnD && q.type === 'DRAG_AND_DROP') return false; // Remove other DnD
        return true;
      });
      
      setQuestionBuffer(newBuffer);

      // If the buffered question already has an image, set it
      if (nextQ.preloadedImageUrl) {
        setPreloadedRewardImage(nextQ.preloadedImageUrl);
      }
      
      setCurrentQuestion(nextQ);
    } else {
      // Emergency Fallback if buffer is empty or contained only illegal questions
      // We force generate a new one, explicitly disallowing DragDrop
      setLoading(true);
      const difficulty = settings.subjectDifficulty[subject];
      const carCount = gameState.cars.length;
      const banList = settings.enableBannedTopics ? settings.bannedTopics : [];
      
      // Force allowDragDrop = false since we couldn't find a valid one in buffer
      generateQuestion(subject, difficulty, settings.useDigits, carCount, currentQuestion?.type, banList, false).then(q => {
        setCurrentQuestion(q);
        setLoading(false);
        // Trigger refill
        ensureBufferFilled(subject);
      });
    }
  };

  // Starts a FRESH mission
  const handleStartMission = async (subject: Subject) => {
    playSound('click');
    setSelectedSubject(subject);
    setMissionProgress(0);
    setHasDragDropOccurred(false); // Reset throttle for new mission
    setQuestionBuffer([]); // Clear old buffer
    setPreloadedRewardImage(null);
    setSelectedAnswerIndex(null);
    
    setLoading(true);
    
    // Fetch the FIRST question directly 
    const difficulty = settings.subjectDifficulty[subject];
    const carCount = gameState.cars.length;
    const banList = settings.enableBannedTopics ? settings.bannedTopics : [];
    
    // For the very first question, we allow DragDrop logic to apply normally
    // BUT, we set allowDragDrop to true initially.
    const firstQuestion = await generateQuestion(subject, difficulty, settings.useDigits, carCount, undefined, banList, true);
    
    // If the FIRST question is DnD, mark it immediately
    if (firstQuestion.type === 'DRAG_AND_DROP') {
      setHasDragDropOccurred(true);
    }

    setCurrentQuestion(firstQuestion);
    setLoading(false);
    
    // Start filling buffer
    if (firstQuestion.visualSubject) {
       generateRewardImage(firstQuestion.visualSubject).then(url => {
         if (url) setPreloadedRewardImage(url);
       });
    }
  };

  const handleAnswer = async (index: number) => {
    if (!currentQuestion) return;
    setSelectedAnswerIndex(index); // Mark selected
    const isCorrect = index === currentQuestion.correctAnswerIndex;
    
    if (isCorrect) {
      playSound('success');
      setFeedback({ type: 'success', msg: "RÄTT SVAR! BRA JOBBAT!" });
      setShowExplanation(true);

      if (currentQuestion.visualSubject) {
        setIsGeneratingImage(true);
        // Image generation is triggered via useEffect or preload
        // We just wait a bit if it's not ready
        if (!preloadedRewardImage) {
           // Fallback if not preloaded
           const url = await generateRewardImage(currentQuestion.visualSubject);
           if (url) setPreloadedRewardImage(url);
        }
        setIsGeneratingImage(false);
      }
    } else {
      setFeedback({ type: 'error', msg: "INTE RIKTIGT... FÖRSÖK IGEN ELLER BE OM HJÄLP." });
    }
  };

  const handleDragDropComplete = (success: boolean) => {
    if (success) {
      playSound('success');
      setFeedback({ type: 'success', msg: "FANTASTISKT! ALLT ÄR PÅ PLATS!" });
      setShowExplanation(true);
      // Drag drop never has a generated image visual subject usually, but if so:
      // ...
    }
  };

  const handleNext = () => {
    if (!selectedSubject) return;
    const newProgress = missionProgress + 1;
    setMissionProgress(newProgress);

    if (newProgress >= MISSION_TARGET) {
       // MISSION COMPLETE
       const nextCarType = ['PASSENGER', 'CARGO', 'TANKER', 'COAL'][Math.floor(Math.random() * 4)] as any;
       const newCar: TrainCar = {
         id: crypto.randomUUID(),
         type: nextCarType,
         color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]
       };
       
       setGameState(prev => ({
         ...prev,
         score: prev.score + 100,
         cars: [...prev.cars, newCar],
         currentStreak: prev.currentStreak + 1
       }));

       // Go back to menu
       setSelectedSubject(null);
       setQuestionBuffer([]); // Clear buffer to save memory
    } else {
      loadNextQuestion(selectedSubject);
    }
  };

  const handleReportBadImage = () => {
    if (currentQuestion?.visualSubject) {
      removeBadImage(currentQuestion.visualSubject);
      setPreloadedRewardImage(null); // Hide it
      alert("Vi har tagit bort bilden. Vi fixar en ny nästa gång!");
    }
  };

  return (
    <Layout settings={settings} setSettings={setSettings} showSettings={showSettings} setShowSettings={setShowSettings}>
      
      {/* STICKY HEADER & MOBILE TRAIN GROUP */}
      <div className="sticky top-0 z-50 w-full shadow-lg">
        
        {/* Header */}
        <header className={`bg-blue-600 transition-all duration-300 ${isMissionActive ? 'py-1 px-2' : 'p-4'}`}>
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedSubject(null)} className="text-white text-2xl hover:scale-110 transition-transform">
                🚂
              </button>
              <div>
                 <h1 className={`text-white font-black tracking-wider drop-shadow-md transition-all ${isMissionActive ? 'text-lg' : 'text-xl'}`}>
                   TÅGMÄSTAREN
                 </h1>
                 <div className={`flex gap-2 text-blue-100 font-bold transition-all ${isMissionActive ? 'text-[10px]' : 'text-xs'}`}>
                   <span>VAGNAR: {gameState.cars.length}</span>
                   {!isMissionActive && (
                     <>
                       <span>|</span>
                       <span>POÄNG: {gameState.score}</span>
                     </>
                   )}
                 </div>
              </div>
            </div>
            <div className="flex gap-3">
               <button onClick={() => setShowHelp(true)} className={`bg-blue-500 rounded-full hover:bg-blue-400 transition-colors ${isMissionActive ? 'p-1' : 'p-2'}`} title="Hjälp">
                 🛟
               </button>
               <button onClick={() => setShowSettings(true)} className={`bg-blue-500 rounded-full hover:bg-blue-400 transition-colors ${isMissionActive ? 'p-1' : 'p-2'}`} title="Inställningar">
                 ⚙️
               </button>
            </div>
          </div>
        </header>

        {/* Mobile Train (Attached to header) */}
        <div className="md:hidden pointer-events-none bg-slate-800">
            <div className="pointer-events-auto">
                <TrainViz cars={gameState.cars} compact={isMissionActive} />
            </div>
        </div>

      </div>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <main className={`flex-1 max-w-3xl mx-auto w-full pb-32 ${isMissionActive ? 'p-2 pt-4' : 'p-4'}`}>
        
        {!selectedSubject ? (
          // --- MENU SELECTION ---
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-8 animate-fade-in">
            <div className="col-span-1 sm:col-span-2 text-center mb-8">
              <Conductor message="VÄLKOMMEN TILLBAKA! VAD VILL DU TRÄNA PÅ IDAG?" mood="happy" />
            </div>

            {(Object.keys(settings.subjectDifficulty) as Subject[]).map((subject) => (
              <button
                key={subject}
                onClick={() => handleStartMission(subject)}
                className="group relative bg-white p-6 rounded-3xl shadow-lg hover:shadow-2xl border-b-8 border-blue-200 active:border-b-0 active:translate-y-2 transition-all duration-200 overflow-hidden"
              >
                <div className="absolute top-0 right-0 bg-blue-100 px-3 py-1 rounded-bl-xl font-bold text-blue-800 text-xs">
                   NIVÅ {settings.subjectDifficulty[subject]}
                </div>
                <div className="text-6xl mb-4 group-hover:scale-110 transition-transform duration-300">
                  {subject === Subject.MATH && '🚂🔢'}
                  {subject === Subject.LANGUAGE && '🚂🅰️'}
                  {subject === Subject.LOGIC && '🚂🧩'}
                  {subject === Subject.PHYSICS && '🚂⚡️'}
                </div>
                <h2 className="text-2xl font-black text-slate-700 uppercase tracking-wide">
                  {subject === Subject.MATH && 'RÄKNETÅGET'}
                  {subject === Subject.LANGUAGE && 'BOKSTAVSTÅGET'}
                  {subject === Subject.LOGIC && 'KLURTÅGET'}
                  {subject === Subject.PHYSICS && 'UPPTÄCKARTÅGET'}
                </h2>
                <p className="text-slate-400 font-bold text-sm mt-2">
                  {subject === Subject.MATH && 'Räkna och siffror'}
                  {subject === Subject.LANGUAGE && 'Ord och bokstäver'}
                  {subject === Subject.LOGIC && 'Klura och tänk'}
                  {subject === Subject.PHYSICS && 'Natur och teknik'}
                </p>
              </button>
            ))}
          </div>
        ) : (
          // --- GAME VIEW ---
          <div className="animate-slide-up relative">
            <MissionProgress current={missionProgress} target={MISSION_TARGET} compact={isMissionActive} />
            
            <div className={`mb-2 md:mb-6`} onClick={handleSpeakQuestion}>
               <Conductor 
                 message={showExplanation ? currentQuestion?.explanation || "BRA JOBBAT!" : (currentQuestion?.text || "LADDAR...")} 
                 mood={showExplanation ? 'happy' : 'thinking'} 
               />
            </div>

            {loading || !currentQuestion ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin text-6xl">⚙️</div>
                <p className="sr-only">Laddar...</p>
              </div>
            ) : (
              <div className="space-y-4 md:space-y-6">
                 
                 {/* GAME AREA GRID: Stacked Layout for Overlay Effect */}
                 <div className="grid grid-cols-1 relative min-h-[300px]">
                    
                    {/* LAYER 1: QUESTION CONTENT (Options or DragDrop) */}
                    <div className={`col-start-1 row-start-1 transition-all duration-500 ease-in-out ${showExplanation ? 'opacity-10 blur-sm grayscale pointer-events-none' : 'opacity-100'}`}>
                      {currentQuestion.type === 'DRAG_AND_DROP' && currentQuestion.dragDropConfig ? (
                          <div className="bg-white p-2 md:p-4 rounded-3xl shadow-xl border-4 border-blue-100">
                            <DragDropChallenge 
                              config={currentQuestion.dragDropConfig} 
                              onComplete={handleDragDropComplete}
                            />
                          </div>
                      ) : (
                          <div className="grid grid-cols-1 gap-3 md:gap-4">
                            {currentQuestion.options?.map((option, index) => {
                              // Simple highlight for selected, but mostly rely on the overlay for result
                              let btnClass = "bg-white hover:bg-blue-50 border-slate-200 text-slate-700"; 
                              if (selectedAnswerIndex === index) {
                                btnClass = "bg-blue-100 border-blue-400 text-blue-900";
                              }

                              return (
                                <button
                                  key={index}
                                  onClick={() => !showExplanation && handleAnswer(index)}
                                  disabled={showExplanation}
                                  className={`
                                    p-3 md:p-6 rounded-xl md:rounded-2xl border-b-4 md:border-b-8 text-lg md:text-2xl font-bold transition-all duration-200
                                    flex items-center justify-center text-center min-h-[60px] md:min-h-[100px]
                                    ${btnClass}
                                    active:border-b-0 active:translate-y-1 md:active:translate-y-2 shadow-sm
                                  `}
                                >
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                      )}
                    </div>

                    {/* LAYER 2: RESULT OVERLAY (Absolute on top of Layer 1) */}
                    {(showExplanation && feedback.type === 'success') && (
                       <div className="col-start-1 row-start-1 z-20 flex flex-col items-center justify-center gap-4 p-2 animate-fade-in">
                           
                           {/* Success Message Badge */}
                           <div className="bg-green-100 text-green-800 px-6 py-2 rounded-full font-black text-xl shadow-lg border-2 border-green-200 animate-bounce">
                             RÄTT SVAR!
                           </div>

                           {/* REWARD CARD */}
                           {currentQuestion.visualSubject && (
                              <div className="bg-white p-2 rounded-3xl shadow-2xl border-4 border-yellow-200 rotate-1 w-full max-w-sm">
                                 {preloadedRewardImage ? (
                                   <div className="relative">
                                      <img 
                                        src={preloadedRewardImage} 
                                        alt="Reward" 
                                        className="w-full max-h-[40vh] object-contain rounded-xl bg-slate-50" 
                                      />
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleReportBadImage(); }}
                                        className="absolute top-2 right-2 bg-white/80 hover:bg-red-100 text-red-600 p-1 rounded-full text-xs font-bold border border-red-200 shadow-sm z-10"
                                        title="Rapportera konstig bild"
                                      >
                                        🚩
                                      </button>
                                   </div>
                                 ) : (
                                   <div className="h-48 flex flex-col items-center justify-center text-slate-300 bg-slate-50 rounded-xl">
                                      <span className="text-4xl animate-bounce">🎨</span>
                                      <span className="text-sm font-bold mt-2">MÅLAR BILD...</span>
                                   </div>
                                 )}
                                 <p className="text-center text-slate-400 text-xs font-bold mt-2 uppercase">{currentQuestion.visualSubject}</p>
                              </div>
                           )}

                           {/* NEXT BUTTON */}
                           <button 
                              onClick={handleNext}
                              className="w-full max-w-sm bg-blue-600 hover:bg-blue-500 text-white text-2xl font-black py-4 rounded-3xl shadow-xl border-b-8 border-blue-800 active:border-b-0 active:translate-y-2 transition-all uppercase flex items-center justify-center gap-4"
                            >
                              <span>NÄSTA</span> <span>➡</span>
                           </button>

                       </div>
                    )}
                    
                    {/* Error Feedback Overlay (Optional simple toast) */}
                    {(feedback.type === 'error') && (
                       <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                          <div className="bg-red-100 text-red-800 px-6 py-4 rounded-2xl font-bold text-xl border-4 border-red-200 shadow-xl animate-shake bg-opacity-95">
                             {feedback.msg}
                          </div>
                       </div>
                    )}

                 </div>

              </div>
            )}
          </div>
        )}

      </main>

      {/* FIXED BOTTOM TRAIN (Desktop Only) */}
      <div className="hidden md:block sticky bottom-0 z-40 shadow-2xl pointer-events-none">
        <div className="pointer-events-auto">
           <TrainViz cars={gameState.cars} />
        </div>
      </div>
    
    </Layout>
  );
}