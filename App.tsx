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
  }
};

const MissionProgress = ({ current, target }: { current: number, target: number }) => (
  <div className="flex items-center gap-2 mb-4 justify-center bg-blue-50 py-3 px-6 rounded-full border border-blue-100 mx-auto w-fit">
    <span className="text-blue-800 font-bold mr-2 text-sm">UPPDRAG:</span>
    <div className="flex gap-2">
      {Array.from({ length: target }).map((_, i) => (
        <div 
          key={i}
          className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
            i < current 
              ? 'bg-yellow-400 border-yellow-500 scale-110 shadow-md' 
              : 'bg-white border-slate-300'
          }`}
        >
          {i < current && <span className="text-yellow-900 text-lg">★</span>}
        </div>
      ))}
    </div>
  </div>
);

export default function App() {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    cars: [{ id: 'loco', type: 'LOCOMOTIVE', color: 'red' }], // Start with just the engine
    currentStreak: 0,
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('trainMasterSettings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SETTINGS, ...parsed, subjectDifficulty: { ...DEFAULT_SETTINGS.subjectDifficulty, ...parsed.subjectDifficulty } };
    }
    return DEFAULT_SETTINGS;
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  
  // Question States
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  
  // QUEUE SYSTEM
  const [questionBuffer, setQuestionBuffer] = useState<Question[]>([]);
  const fetchingCountRef = useRef(0); // Tracks active API calls to prevent over-fetching
  
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

  useEffect(() => {
    localStorage.setItem('trainMasterSettings', JSON.stringify(settings));
  }, [settings]);

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
      
      const question = await generateQuestion(subject, difficulty, settings.useDigits, carCount, previousType);
      
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

    if (questionBuffer.length > 0) {
      // Take from Buffer
      const [nextQ, ...remaining] = questionBuffer;
      setQuestionBuffer(remaining); // Update buffer state
      
      // If the buffered question already has an image, set it
      if (nextQ.preloadedImageUrl) {
        setPreloadedRewardImage(nextQ.preloadedImageUrl);
      }
      
      setCurrentQuestion(nextQ);
    } else {
      // Emergency Fallback if buffer is empty
      setLoading(true);
      const difficulty = settings.subjectDifficulty[subject];
      const carCount = gameState.cars.length;
      
      generateQuestion(subject, difficulty, settings.useDigits, carCount, currentQuestion?.type).then(q => {
        setCurrentQuestion(q);
        setLoading(false);
        ensureBufferFilled(subject);
      });
    }
  };

  // Starts a FRESH mission
  const handleStartMission = async (subject: Subject) => {
    playSound('click');
    setSelectedSubject(subject);
    setMissionProgress(0);
    setQuestionBuffer([]); // Clear old buffer
    setPreloadedRewardImage(null);
    
    setLoading(true);
    
    // Fetch the FIRST question directly 
    const difficulty = settings.subjectDifficulty[subject];
    const carCount = gameState.cars.length;
    const firstQuestion = await generateQuestion(subject, difficulty, settings.useDigits, carCount);
    
    setCurrentQuestion(firstQuestion);
    setLoading(false);

    // Start image gen for the first question immediately
    if (firstQuestion.visualSubject) {
      generateRewardImage(firstQuestion.visualSubject).then(url => {
        if (url) {
           setPreloadedRewardImage(url);
           setCurrentQuestion(prev => prev ? { ...prev, preloadedImageUrl: url } : prev);
        }
      });
    }
    
    // The buffer useEffect will kick in automatically since selectedSubject is set
  };

  const handleAnswer = (index: number) => {
    if (!currentQuestion || showExplanation || !currentQuestion.options) return;
    const isCorrect = index === currentQuestion.correctAnswerIndex;
    processResult(isCorrect);
  };

  const handleDragDropResult = (isCorrect: boolean) => {
    if (!currentQuestion || showExplanation) return;
    processResult(isCorrect);
  };

  const processResult = async (isCorrect: boolean) => {
     if (isCorrect) {
      playSound('success');
      
      const newProgress = missionProgress + 1;
      setMissionProgress(newProgress);

      if (newProgress >= MISSION_TARGET) {
        setFeedback({ type: 'success', msg: "HELT RÄTT! UPPDRAGET KLART!" });
      } else {
        setFeedback({ type: 'success', msg: "RÄTT! EN STJÄRNA TILL!" });
      }

      setGameState(prev => ({
        ...prev,
        score: prev.score + 10, 
        currentStreak: prev.currentStreak + 1
      }));
      
      // Reward Image Display Logic
      if (currentQuestion?.visualSubject) {
        if (!preloadedRewardImage) {
           // Fallback: User answered faster than generation
           setIsGeneratingImage(true);
           const imgData = await generateRewardImage(currentQuestion.visualSubject);
           if (imgData) {
             setPreloadedRewardImage(imgData);
           }
           setIsGeneratingImage(false);
        }
      }

    } else {
      setGameState(prev => ({ ...prev, currentStreak: 0 }));
      setFeedback({ type: 'error', msg: "INTE RIKTIGT. FÖRSÖK MED NÄSTA!" });
      
      // Force check buffer just in case
      if (selectedSubject) ensureBufferFilled(selectedSubject);
    }

    setShowExplanation(true);
  };

  const handleTooHard = async () => {
    if (!currentQuestion || !selectedSubject) return;
    
    // Mark as too hard in DB (increase level)
    await markQuestionTooHard(currentQuestion);
    
    // Show momentary feedback
    setFeedback({ type: 'error', msg: "FIXAT! SPARAD FÖR ÄLDRE BARN. HÄMTA NY..." });
    
    // Short delay then load next
    setTimeout(() => {
       loadNextQuestion(selectedSubject);
    }, 1500);
  };
  
  const handleReportBadImage = async () => {
    if (!currentQuestion?.visualSubject) return;
    await removeBadImage(currentQuestion.visualSubject);
    setPreloadedRewardImage(null);
  };

  const handleContinue = () => {
    if (missionProgress >= MISSION_TARGET && feedback.type === 'success') {
      completeMissionAndAddCar();
    } else {
      if (selectedSubject) {
        loadNextQuestion(selectedSubject);
      }
    }
  };

  const completeMissionAndAddCar = () => {
    const randomColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const carTypes: TrainCar['type'][] = ['PASSENGER', 'CARGO', 'TANKER'];
    const randomType = carTypes[Math.floor(Math.random() * carTypes.length)];

    const newCar: TrainCar = {
      id: crypto.randomUUID(),
      type: randomType,
      color: randomColor
    };

    setGameState(prev => ({
      ...prev,
      score: prev.score + 100, 
      cars: [...prev.cars, newCar]
    }));

    returnToMenu();
  };

  const returnToMenu = () => {
    setSelectedSubject(null);
    setCurrentQuestion(null);
    setQuestionBuffer([]);
    setShowExplanation(false);
    setFeedback({ type: null, msg: "" });
    setMissionProgress(0);
    setPreloadedRewardImage(null);
  };

  const Header = ({ showScore = true }) => (
    <div className="bg-white p-4 shadow-sm flex justify-between items-center z-20 relative">
      <h1 className="text-2xl font-bold text-blue-900 flex items-center gap-2 uppercase">
        🚂 TÅGMÄSTAREN
      </h1>
      <div className="flex items-center gap-4">
        {showScore && (
          <div className="bg-yellow-100 px-4 py-1 rounded-full font-bold text-yellow-800 border border-yellow-300 uppercase">
            POÄNG: {gameState.score}
          </div>
        )}
        <button 
          onClick={() => setShowSettings(true)}
          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
          aria-label="Inställningar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      </div>
    </div>
  );

  if (!selectedSubject && !currentQuestion) {
    return (
      <Layout 
        settings={settings} 
        setSettings={setSettings} 
        showSettings={showSettings} 
        setShowSettings={setShowSettings}
      >
        <Header />
        <div className="mt-4 mb-8">
          <TrainViz cars={gameState.cars} />
        </div>
        <div className="flex-1 container mx-auto px-4 pb-10 flex flex-col items-center justify-center">
          <Conductor 
            mood="happy" 
            message={gameState.cars.length === 1 
              ? "VÄLKOMMEN OMBORD! LOKET ÄR REDO. KLARA AV 5 UPPGIFTER FÖR ATT FÅ EN NY VAGN!" 
              : `BRA JOBBAT! TÅGET ÄR NU ${gameState.cars.length} VAGNAR LÅNGT. VÄLJ ETT SPÅR FÖR NÄSTA UPPDRAG!`} 
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-3xl mt-8">
            <SubjectCard 
              title="MATEMATIK-EXPRESSEN" 
              icon="🔢" 
              color="bg-rose-100 border-rose-300 text-rose-800 hover:bg-rose-200"
              onClick={() => handleStartMission(Subject.MATH)} 
            />
            <SubjectCard 
              title="ORD-LOKET" 
              icon="📚" 
              color="bg-emerald-100 border-emerald-300 text-emerald-800 hover:bg-emerald-200"
              onClick={() => handleStartMission(Subject.LANGUAGE)} 
            />
            <SubjectCard 
              title="UPPFINNAR-SPÅRET (FYSIK)" 
              icon="⚡" 
              color="bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200"
              onClick={() => handleStartMission(Subject.PHYSICS)} 
            />
            <SubjectCard 
              title="KLURIGA STATIONEN (LOGIK)" 
              icon="🧩" 
              color="bg-indigo-100 border-indigo-300 text-indigo-800 hover:bg-indigo-200"
              onClick={() => handleStartMission(Subject.LOGIC)} 
            />
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout 
      settings={settings} 
      setSettings={setSettings} 
      showSettings={showSettings} 
      setShowSettings={setShowSettings}
    >
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      
      <div className="bg-white p-4 shadow-sm flex justify-between items-center">
        <button 
          onClick={() => returnToMenu()}
          className="text-slate-500 hover:text-slate-800 font-bold flex items-center gap-2 uppercase"
        >
          ⬅ AVBRYT UPPDRAG
        </button>
        <div className="flex items-center gap-4">
          <div className="font-bold text-slate-400 text-xs sm:text-sm uppercase">
             {selectedSubject ? Subject[selectedSubject] : ''} NIVÅ {selectedSubject ? settings.subjectDifficulty[selectedSubject] : ''}
          </div>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
          >
             <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="text-center">
            <div className="text-6xl animate-bounce mb-4">🚂</div>
            <p className="text-xl font-bold text-slate-600 uppercase">FÖRBEREDER NÄSTA UPPGIFT...</p>
          </div>
        ) : currentQuestion ? (
          <div className="w-full flex flex-col gap-6">
            
            <MissionProgress current={missionProgress} target={MISSION_TARGET} />

            {/* Reward Image Section */}
            {feedback.type === 'success' && (isGeneratingImage || preloadedRewardImage) && (
              <div className="flex flex-col items-center justify-center animate-bounce-in mb-2">
                 {isGeneratingImage ? (
                   <div className="bg-white p-4 rounded-2xl shadow-lg border-2 border-purple-200 flex flex-col items-center">
                      <div className="text-3xl animate-spin mb-2">🎨</div>
                      <p className="text-sm font-bold text-purple-600 uppercase">DEN MAGISKA PENSELN RITAR...</p>
                   </div>
                 ) : preloadedRewardImage ? (
                   <div className="relative group">
                     <div className="bg-white p-3 rounded-2xl shadow-xl border-4 border-yellow-300 transform rotate-1 max-w-xs relative">
                        <img src={preloadedRewardImage} alt="Reward" className="rounded-xl w-48 h-48 object-cover border border-slate-100" />
                        <div className="text-center mt-2">
                          <p className="font-bold text-slate-800 text-xl uppercase">
                            {currentQuestion.options && currentQuestion.correctAnswerIndex !== undefined 
                              ? currentQuestion.options?.[currentQuestion.correctAnswerIndex ?? 0] 
                              : ""}
                          </p>
                        </div>
                     </div>
                     
                     {/* Report Bad Image Button */}
                     <button
                        onClick={handleReportBadImage}
                        className="absolute -top-2 -right-2 bg-white text-slate-400 hover:text-red-500 border-2 border-slate-200 hover:border-red-200 rounded-full w-10 h-10 flex items-center justify-center shadow-md transition-colors z-20 active:scale-95"
                        title="Ta bort felaktig bild"
                        aria-label="Ta bort felaktig bild"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                     </button>
                   </div>
                 ) : null}
              </div>
            )}

            {feedback.msg ? (
              <Conductor 
                mood={feedback.type === 'success' ? 'excited' : 'thinking'} 
                message={showExplanation ? `${feedback.msg} ${currentQuestion.explanation}` : feedback.msg} 
              />
            ) : (
              <Conductor 
                mood="waiting" 
                message={
                  missionProgress === 0 ? "NYTT UPPDRAG STARTAT! KÖR HÅRT!" : 
                  missionProgress === MISSION_TARGET - 1 ? "EN STJÄRNA KVAR TILL VAGNEN! DU KLARAR DET!" :
                  "SAMLA STJÄRNOR FÖR ATT KOPPLA PÅ VAGNEN!"
                } 
              />
            )}

            <div className="bg-white rounded-3xl shadow-xl p-8 border-4 border-blue-100 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
               
               <div className="flex flex-wrap justify-between mb-2 relative z-10 gap-2">
                  <button 
                     onClick={handleSpeakQuestion}
                     disabled={isPlayingAudio}
                     className={`bg-yellow-100 hover:bg-yellow-200 text-yellow-800 border-2 border-yellow-300 rounded-full px-4 py-1 font-bold text-sm flex items-center gap-2 transition-transform hover:scale-105 ${isPlayingAudio ? 'opacity-50' : ''}`}
                     aria-label="Läs upp frågan"
                  >
                    <span className="text-xl">🔊</span> {isPlayingAudio ? 'LÄSER...' : 'LÄS UPP'}
                  </button>

                 <div className="flex gap-2">
                   <button 
                      onClick={handleTooHard}
                      className="bg-red-100 hover:bg-red-200 text-red-700 border-2 border-red-300 rounded-full px-4 py-1 font-bold text-sm flex items-center gap-2 transition-transform hover:scale-105"
                      title="Flytta frågan till en svårare nivå"
                   >
                     <span className="text-xl">🎓</span> FÖR SVÅR
                   </button>

                   <button 
                      onClick={() => setShowHelp(true)}
                      className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 border-2 border-indigo-300 rounded-full px-4 py-1 font-bold text-sm flex items-center gap-2 transition-transform hover:scale-105"
                   >
                     <span className="text-xl">🛟</span> HJÄLP
                   </button>
                 </div>
               </div>

               <h2 className="text-2xl md:text-3xl font-bold text-slate-800 mb-8 text-center leading-snug relative z-10 uppercase">
                 {currentQuestion.text}
               </h2>

               {currentQuestion.type === 'DRAG_AND_DROP' && currentQuestion.dragDropConfig ? (
                 !showExplanation ? (
                   <DragDropChallenge 
                     config={currentQuestion.dragDropConfig} 
                     onComplete={handleDragDropResult}
                   />
                 ) : (
                    <div className="p-10 text-center text-6xl animate-bounce">
                     {feedback.type === 'success' ? '🌟' : '🤔'}
                   </div>
                 )
               ) : (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                   {currentQuestion.options?.map((option, idx) => {
                     let btnClass = "bg-white border-4 border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-blue-50";
                     
                     if (showExplanation) {
                       if (idx === currentQuestion.correctAnswerIndex) {
                          btnClass = "bg-green-100 border-green-500 text-green-900 font-bold shadow-lg scale-105";
                       } else if (feedback.type === 'error' && option === currentQuestion.options?.[idx]) {
                          btnClass = "opacity-50 bg-slate-100"; 
                       } else {
                          btnClass = "opacity-50 bg-slate-50";
                       }
                     }

                     return (
                       <button
                         key={idx}
                         onClick={() => handleAnswer(idx)}
                         disabled={showExplanation}
                         className={`p-6 rounded-2xl text-xl font-semibold transition-all duration-200 transform active:scale-95 shadow-sm uppercase ${btnClass}`}
                       >
                         {option}
                       </button>
                     );
                   })}
                 </div>
               )}

               {showExplanation && (
                 <div className="mt-8 flex justify-center relative z-10">
                   <button
                     onClick={handleContinue}
                     className={`text-white text-xl font-bold py-4 px-12 rounded-full shadow-lg transition-transform transform hover:-translate-y-1 animate-bounce uppercase ${
                       missionProgress >= MISSION_TARGET && feedback.type === 'success'
                        ? "bg-green-600 hover:bg-green-700 shadow-green-200" 
                        : "bg-blue-600 hover:bg-blue-700 shadow-blue-200"
                     }`}
                   >
                     {missionProgress >= MISSION_TARGET && feedback.type === 'success'
                        ? "KOPPLA PÅ VAGNEN! 🚋" 
                        : "NÄSTA UPPGIFT ➡"}
                   </button>
                 </div>
               )}
            </div>
          </div>
        ) : null}
      </div>
      <div className="h-4 bg-stripes-slate w-full opacity-10"></div>
    </Layout>
  );
}

const SubjectCard = ({ title, icon, color, onClick }: { title: string, icon: string, color: string, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`group relative overflow-hidden p-6 rounded-3xl border-b-8 transition-all duration-200 transform hover:-translate-y-1 active:translate-y-1 active:border-b-0 ${color} text-left flex items-center gap-4 shadow-sm uppercase`}
  >
    <span className="text-4xl filter drop-shadow-sm transform group-hover:scale-110 transition-transform duration-300">{icon}</span>
    <span className="text-xl font-bold">{title}</span>
    <div className="absolute right-4 opacity-0 group-hover:opacity-100 transition-opacity text-2xl">➡</div>
  </button>
);