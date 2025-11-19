
import React, { useState, useEffect } from 'react';
import { AppSettings, Subject, FirebaseConfig } from '../types';
import { trainDb, DbStats, StorageEstimate, CloudStats } from '../services/db';
import { testApiKey, batchGenerateQuestions, batchGenerateImages, getApiKeyDebug, setRuntimeApiKey, clearRuntimeApiKey, getKeySource, toggleBlockEnvKey, isEnvKeyBlocked } from '../services/geminiService';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onClose: () => void;
}

const SUBJECT_LABELS: Record<Subject, string> = {
  [Subject.MATH]: 'MATEMATIK',
  [Subject.LANGUAGE]: 'SVENSKA',
  [Subject.PHYSICS]: 'TEKNIK/FYSIK',
  [Subject.LOGIC]: 'LOGIK'
};

const LEVEL_LABELS: Record<number, string> = {
  1: 'FÖRSKOLEKLASS',
  2: 'ÅRSKURS 1',
  3: 'ÅRSKURS 2',
  4: 'ÅRSKURS 3',
  5: 'UTMANANDE'
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onUpdateSettings, onClose }) => {
  // UI State
  const [view, setView] = useState<'MAIN' | 'ADVANCED'>('MAIN');
  
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [storageEst, setStorageEst] = useState<StorageEstimate | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionErrorMsg, setConnectionErrorMsg] = useState<string>("");
  const [cloudStatus, setCloudStatus] = useState<string>("");
  const [tempFirebaseConfig, setTempFirebaseConfig] = useState<string>("");
  
  // Banned Topics State for editing
  const [bannedTopicsInput, setBannedTopicsInput] = useState<string>("");
  
  // Load persisted key for display
  const [manualKey, setManualKey] = useState<string>("");
  
  useEffect(() => {
      const savedKey = localStorage.getItem('trainMasterApiKey');
      if (savedKey) setManualKey(savedKey);
      
      // Initialize ban list input
      if (settings.bannedTopics) {
        setBannedTopicsInput(settings.bannedTopics.join(', '));
      }
  }, []);
  
  // Cloud Stats
  const [cloudStats, setCloudStats] = useState<CloudStats | null>(null);
  const [checkingCloud, setCheckingCloud] = useState(false);

  // Question Generator State
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genTarget, setGenTarget] = useState(0);
  const [genError, setGenError] = useState<string>("");

  // Image Generator State
  const [missingImagesCount, setMissingImagesCount] = useState<number>(0);
  const [missingImagePrompts, setMissingImagePrompts] = useState<string[]>([]);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imgGenProgress, setImgGenProgress] = useState(0);

  // Key Source Info
  const keyDebug = getApiKeyDebug();
  const keySource = getKeySource(); // 'MANUAL' | 'ENV_VITE' | 'ENV_PROCESS' | 'NONE'
  const isBlocked = isEnvKeyBlocked();
  const hasKey = keySource !== 'NONE';

  const isEnvConnected = trainDb.isCloudConnected();

  // Initialize DB cloud connection if settings exist manually
  useEffect(() => {
    if (!isEnvConnected && settings.firebaseConfig) {
      trainDb.initCloud(settings.firebaseConfig);
    }
    
    // Load Stats and Storage
    refreshLocalStats();
    
    if (settings.firebaseConfig) {
        setTempFirebaseConfig(JSON.stringify(settings.firebaseConfig, null, 2));
    }

    // Auto-check cloud on open if connected
    if (trainDb.isCloudConnected()) {
      refreshCloudStats();
    }
  }, [settings.firebaseConfig, isEnvConnected]);

  const refreshLocalStats = () => {
    trainDb.getDatabaseStats().then(setDbStats);
    trainDb.getStorageEstimate().then(setStorageEst);
    
    // Check for missing images
    trainDb.getMissingVisualSubjects().then(prompts => {
        setMissingImagePrompts(prompts);
        setMissingImagesCount(prompts.length);
    });
  };

  const refreshCloudStats = async () => {
    setCheckingCloud(true);
    const stats = await trainDb.getCloudStats();
    setCloudStats(stats);
    setCheckingCloud(false);
  };

  const updateDifficulty = (subject: Subject, change: number) => {
    const current = settings.subjectDifficulty[subject];
    const newLevel = Math.min(5, Math.max(1, current + change));
    
    onUpdateSettings({
      ...settings,
      subjectDifficulty: {
        ...settings.subjectDifficulty,
        [subject]: newLevel
      }
    });
  };
  
  const handleSaveBannedTopics = () => {
    const list = bannedTopicsInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
    onUpdateSettings({
      ...settings,
      bannedTopics: list
    });
  };

  const handleBatchGenerate = async (count: number) => {
    if (!hasKey) {
        setGenError("Ingen AI-nyckel hittades! Konfigurera Gemini API-nyckel först.");
        return;
    }
    
    setIsGenerating(true);
    setGenTarget(count);
    setGenProgress(0);
    setGenError("");
    
    const banList = settings.enableBannedTopics ? settings.bannedTopics : [];
    
    await batchGenerateQuestions(
        count, 
        settings.useDigits, 
        settings.subjectDifficulty, 
        banList,
        (done) => {
            setGenProgress(done);
        },
        (errorMsg) => {
            setGenError(errorMsg);
        }
    );
    
    setIsGenerating(false);
    refreshLocalStats();
  };

  const handleGenerateMissingImages = async () => {
    if (missingImagePrompts.length === 0) return;
    
    setIsGeneratingImages(true);
    setImgGenProgress(0);
    
    await batchGenerateImages(
        missingImagePrompts,
        (done) => setImgGenProgress(done),
        (err) => console.warn(err)
    );
    
    setIsGeneratingImages(false);
    refreshLocalStats();
    refreshCloudStats();
  };

  const handleExport = async () => {
    try {
      setBackupStatus("Förbereder fil...");
      const json = await trainDb.exportDatabase();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `tagmastaren-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setBackupStatus("Backup sparad!");
      setTimeout(() => setBackupStatus(""), 3000);
    } catch (e) {
      console.error(e);
      setBackupStatus("Fel vid export");
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      try {
        setBackupStatus("Läser in...");
        const count = await trainDb.importDatabase(text);
        setBackupStatus(`Klart! ${count} frågor inlästa.`);
        setTimeout(() => window.location.reload(), 2000); 
      } catch (error) {
        console.error(error);
        setBackupStatus("Felaktig fil.");
      }
    };
    reader.readAsText(file);
  };

  const handleTestConnection = async () => {
    // If manual key is present, inject it and SAVE IT
    if (manualKey.trim().length > 10) {
       setRuntimeApiKey(manualKey.trim());
    }

    setConnectionStatus('testing');
    setConnectionErrorMsg("");
    
    const result = await testApiKey();
    
    if (result.success) {
       setConnectionStatus('success');
       setGenError(""); 
    } else {
       setConnectionStatus('error');
       setConnectionErrorMsg(result.message || "Okänt fel");
    }
    
    setTimeout(() => {
      if (connectionStatus !== 'error') setConnectionStatus('idle');
    }, 5000);
  };
  
  const handleClearKey = () => {
    clearRuntimeApiKey();
    setManualKey("");
    setConnectionStatus('idle');
  };
  
  const handleToggleBlockEnv = () => {
     const newState = !isBlocked;
     toggleBlockEnvKey(newState);
     // Force re-render logic by updating state implicitly
     setConnectionStatus('idle'); 
  };

  const handleSaveFirebaseConfig = () => {
    try {
        const config = JSON.parse(tempFirebaseConfig);
        onUpdateSettings({
            ...settings,
            firebaseConfig: config
        });
        trainDb.initCloud(config);
        setCloudStatus("Konfiguration sparad!");
        refreshCloudStats();
    } catch (e) {
        setCloudStatus("Felaktig JSON!");
    }
  };

  const handleCloudSync = async (direction: 'up' | 'down') => {
    if (!trainDb.isCloudConnected()) {
      setCloudStatus("Ingen anslutning konfigurerad!");
      return;
    }
    
    try {
      setCloudStatus("Synkroniserar...");
      if (direction === 'up') {
        const count = await trainDb.syncLocalToCloud();
        setCloudStatus(`Skickade frågor och bilder till molnet!`);
      } else {
        const count = await trainDb.syncCloudToLocal();
        setCloudStatus(`Hämtade ${count} frågor från molnet! (Bilder arkiveras i molnet)`);
      }
      refreshLocalStats();
      refreshCloudStats();
    } catch (e: any) {
      console.error(e);
      setCloudStatus("Fel: " + e.message);
    }
  };

  const handleSendTestData = async () => {
    setCloudStatus("Skickar testdata...");
    try {
      await trainDb.sendTestData();
      setCloudStatus("✅ Testdata skickat! Kolla i Firebase-konsolen.");
    } catch (e: any) {
      console.error(e);
      setCloudStatus("❌ Fel: " + e.message);
    }
  };

  const getTotalLocalQuestions = () => {
    if (!dbStats) return 0;
    return dbStats.mathCount + dbStats.languageCount + dbStats.logicCount + dbStats.physicsCount;
  };

  const getAiUsageLevel = (total: number) => {
      if (total < 50) return { level: 1, ai: 100, db: 0, desc: "BYGGER UPP DATABAS" };
      if (total < 100) return { level: 2, ai: 20, db: 80, desc: "BLANDAR NYTT & GAMMALT" };
      if (total < 200) return { level: 3, ai: 10, db: 90, desc: "UNDERHÅLLSLÄGE" };
      return { level: 4, ai: 5, db: 95, desc: "SPARLÄGE (Mest databas)" };
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const aiLogic = getAiUsageLevel(getTotalLocalQuestions());

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border-4 border-blue-200 p-6 relative animate-bounce-in my-8">
          
          {/* Close Button */}
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full p-2 transition-colors z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <h2 className="text-2xl font-bold text-blue-900 mb-6 flex items-center gap-3 uppercase">
            {view === 'MAIN' ? '⚙️ INSTÄLLNINGAR' : '🔧 AVANCERADE INSTÄLLNINGAR'}
          </h2>

          <div className="space-y-6">
            
            {/* === MAIN VIEW === */}
            {view === 'MAIN' && (
              <>
                {/* --- GENERAL SETTINGS --- */}
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border-2 border-blue-100">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">STORA BOKSTÄVER</h3>
                    <p className="text-slate-500 text-sm">Gör all text lättare att läsa</p>
                  </div>
                  
                  <button 
                    onClick={() => onUpdateSettings({ ...settings, useUppercase: !settings.useUppercase })}
                    className={`w-16 h-8 rounded-full transition-colors duration-300 relative flex items-center ${settings.useUppercase ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div 
                      className={`w-6 h-6 bg-white rounded-full shadow-md absolute transition-transform duration-300 ${settings.useUppercase ? 'translate-x-9' : 'translate-x-1'}`}
                    ></div>
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border-2 border-blue-100">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">SIFFROR SOM 1, 2, 3</h3>
                    <p className="text-slate-500 text-sm">Visa tal som siffror istället för ord</p>
                  </div>
                  
                  <button 
                    onClick={() => onUpdateSettings({ ...settings, useDigits: !settings.useDigits })}
                    className={`w-16 h-8 rounded-full transition-colors duration-300 relative flex items-center ${settings.useDigits ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div 
                      className={`w-6 h-6 bg-white rounded-full shadow-md absolute transition-transform duration-300 ${settings.useDigits ? 'translate-x-9' : 'translate-x-1'}`}
                    ></div>
                  </button>
                </div>

                <div>
                  <h3 className="font-bold text-slate-800 text-lg mb-4 border-b-2 border-slate-100 pb-2">SVÅRIGHETSNIVÅER</h3>
                  <div className="space-y-4">
                    {(Object.values(Subject) as Subject[]).map((subject) => (
                      <div key={subject} className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-bold text-slate-700">{SUBJECT_LABELS[subject]}</span>
                          <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">
                             {LEVEL_LABELS[settings.subjectDifficulty[subject]]} (Nivå {settings.subjectDifficulty[subject]})
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => updateDifficulty(subject, -1)}
                            disabled={settings.subjectDifficulty[subject] <= 1}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-white border-2 border-slate-300 text-slate-600 font-bold hover:bg-red-50 hover:border-red-200 disabled:opacity-30"
                          >
                            -
                          </button>
                          <div className="flex-1 h-4 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500 transition-all duration-300"
                              style={{ width: `${(settings.subjectDifficulty[subject] / 5) * 100}%` }}
                            ></div>
                          </div>
                          <button 
                            onClick={() => updateDifficulty(subject, 1)}
                            disabled={settings.subjectDifficulty[subject] >= 5}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-white border-2 border-slate-300 text-slate-600 font-bold hover:bg-green-50 hover:border-green-200 disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 mt-4">
                   <button 
                     onClick={() => setView('ADVANCED')}
                     className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-4 px-6 rounded-xl border-2 border-slate-200 transition-colors flex items-center justify-center gap-2 uppercase"
                   >
                      <span>🔧</span> Avancerade Inställningar
                   </button>
                   <p className="text-[10px] text-center text-slate-400 mt-2">
                     Databas, AI-nycklar, Backup, Filter och Turbo-laddning
                   </p>
                </div>

                <div className="mt-4 flex justify-center">
                  <button 
                    onClick={onClose}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg active:scale-95 transition-all w-full"
                  >
                    STÄNG
                  </button>
                </div>
              </>
            )}

            {/* === ADVANCED VIEW === */}
            {view === 'ADVANCED' && (
              <div className="space-y-8">
                <button 
                  onClick={() => setView('MAIN')}
                  className="text-slate-500 hover:text-blue-600 font-bold flex items-center gap-2 mb-4 uppercase text-sm"
                >
                  ⬅ Tillbaka
                </button>

                {/* --- AI KEY SECTION --- */}
                <div className="flex flex-col gap-3 border-b-2 border-blue-100 pb-6">
                   <h3 className="font-bold text-slate-800 text-lg">1. AI-MOTORN (Google Gemini)</h3>
                   <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center space-y-3">
                      
                      <div className="flex items-center justify-between bg-white p-2 rounded border border-blue-100">
                        <div className="text-left">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">AKTIV NYCKEL</div>
                          <div className={hasKey ? "text-slate-700 font-mono font-bold" : "text-red-600 font-bold"}>
                            {keyDebug}
                          </div>
                        </div>
                        
                        <div className="text-right">
                           <div className="text-[10px] text-slate-400 uppercase font-bold">KÄLLA</div>
                           {keySource === 'MANUAL' && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-bold">MANUELL</span>}
                           {keySource === 'ENV_VITE' && <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded font-bold">ENV (VITE_) ✅</span>}
                           {keySource === 'ENV_PROCESS' && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold">ENV (VERCEL) ✅</span>}
                           {keySource === 'NONE' && <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded font-bold">INGEN</span>}
                        </div>
                      </div>

                      {/* Block Environment Key Toggle */}
                      {keySource !== 'MANUAL' && (
                        <div className="flex items-center justify-between text-xs px-2">
                          <span className="text-slate-500">Använd server-nyckel?</span>
                          <button 
                            onClick={handleToggleBlockEnv}
                            className={`px-3 py-1 rounded-full font-bold transition-colors ${!isBlocked ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'}`}
                          >
                            {isBlocked ? "AVSTÄNGD" : "TILLÅTEN"}
                          </button>
                        </div>
                      )}

                      {!hasKey && !isBlocked && (
                        <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100 text-left">
                          <span className="font-bold">TIPS:</span> Kontrollera att du har en variabel som heter <code>GOOGLE_AI_API_KEY</code> eller <code>VITE_GOOGLE_AI_API_KEY</code> i Vercel.
                        </div>
                      )}
                      
                      <div className="flex flex-col gap-1 mt-2 border-t border-blue-100 pt-3">
                        <label className="text-xs font-bold text-slate-500 uppercase text-left">Mata in nyckel manuellt:</label>
                        <input 
                          type="password"
                          value={manualKey}
                          onChange={(e) => setManualKey(e.target.value)}
                          placeholder="Klistra in din AIza-nyckel här..."
                          className="w-full p-2 rounded border border-blue-200 text-sm font-mono"
                        />
                      </div>
                      
                      <div className="flex gap-2">
                          <button 
                            onClick={handleTestConnection}
                            disabled={connectionStatus === 'testing'}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-colors flex justify-center items-center gap-2 ${
                              connectionStatus === 'success' ? 'bg-green-100 text-green-700 border border-green-300' :
                              connectionStatus === 'error' ? 'bg-red-100 text-red-700 border border-red-300' :
                              'bg-white text-blue-600 border border-blue-200 hover:bg-blue-100'
                            }`}
                          >
                            {connectionStatus === 'idle' && "📡 TESTA & SPARA"}
                            {connectionStatus === 'testing' && "KONTROLLERAR..."}
                            {connectionStatus === 'success' && "✅ OK!"}
                            {connectionStatus === 'error' && "❌ FEL"}
                          </button>
                          
                          {keySource === 'MANUAL' && (
                            <button
                              onClick={handleClearKey}
                              className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-2 text-xs font-bold active:scale-95"
                              title="Rensa manuell nyckel"
                            >
                              RENSA 🗑️
                            </button>
                          )}
                      </div>

                      {connectionStatus === 'error' && connectionErrorMsg && (
                        <div className="bg-red-50 p-2 rounded text-xs font-mono text-red-800 break-all border border-red-100">
                          Felmeddelande: {connectionErrorMsg}
                        </div>
                      )}
                   </div>
                </div>

                {/* AI LOGIC & PROBABILITY */}
                <div className="bg-cyan-50 p-4 rounded-xl border-2 border-cyan-100">
                  <h3 className="font-bold text-cyan-900 text-lg mb-2 border-b border-cyan-200 pb-2">
                    🤖 AI-LOGIK & BLANDNING
                  </h3>
                  <p className="text-xs text-cyan-800 mb-4">
                    Här ser du hur appen väljer mellan att skapa <strong>nya frågor (AI)</strong> och att återanvända <strong>gamla frågor (Databas)</strong> för varje ämne.
                  </p>

                  <div className="bg-white rounded-lg border border-cyan-200 overflow-hidden text-xs">
                    <div className="grid grid-cols-4 bg-cyan-100 p-2 font-bold text-cyan-900">
                      <div>ANTAL I DB</div>
                      <div>AI (NYTT)</div>
                      <div>DATABAS</div>
                      <div>FAS</div>
                    </div>
                    {[
                      { min: 0, max: 49, ai: '100%', db: '0%', name: 'BYGG' },
                      { min: 50, max: 99, ai: '20%', db: '80%', name: 'BLANDA' },
                      { min: 100, max: 199, ai: '10%', db: '90%', name: 'UNDERHÅLL' },
                      { min: 200, max: 9999, ai: '5%', db: '95%', name: 'SPARA' },
                    ].map((tier, idx) => {
                      const isActive = getTotalLocalQuestions() >= tier.min && getTotalLocalQuestions() <= tier.max;
                      return (
                        <div key={idx} className={`grid grid-cols-4 p-2 border-t border-cyan-50 ${isActive ? 'bg-yellow-100 font-bold' : ''}`}>
                          <div>{tier.min === 200 ? '200+' : `${tier.min}-${tier.max}`}</div>
                          <div className="text-purple-600">{tier.ai}</div>
                          <div className="text-green-600">{tier.db}</div>
                          <div>{tier.name}</div>
                        </div>
                      );
                    })}
                  </div>
                  
                  <div className="mt-3 bg-white p-2 rounded border border-cyan-200 flex justify-between items-center">
                     <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400">DIN STATUS JUST NU:</div>
                        <div className="font-bold text-cyan-900">{aiLogic.desc}</div>
                     </div>
                     <div className="text-right">
                        <div className="text-xl font-black text-purple-600">{aiLogic.ai}% AI</div>
                        <div className="text-[10px] text-slate-400">CHANS FÖR NY FRÅGA</div>
                     </div>
                  </div>
                </div>

                {/* CLOUD SYNC SECTION - FIREBASE */}
                <div className="bg-orange-50 p-4 rounded-xl border-2 border-orange-100">
                   <h3 className="font-bold text-orange-900 text-lg mb-2 border-b border-orange-200 pb-2">2. DATABAS (FIREBASE)</h3>
                   <p className="text-xs text-orange-800 mb-4">
                     Spara frågor och bilder säkert i Googles moln. Bilder arkiveras automatiskt i molnet för att spara plats på din enhet.
                   </p>
                   
                   {isEnvConnected ? (
                     <div className="bg-white/50 p-2 rounded mb-4 text-center border border-orange-200">
                       <span className="text-sm text-orange-800 font-bold">✅ ANSLUTEN VIA .ENV FIL</span>
                     </div>
                   ) : (
                     <div className="space-y-2 mb-4">
                       <textarea 
                         placeholder='Klistra in { "apiKey": "...", ... }' 
                         value={tempFirebaseConfig}
                         onChange={(e) => setTempFirebaseConfig(e.target.value)}
                         className="w-full p-2 rounded border border-orange-200 text-xs font-mono h-24"
                       />
                       <button 
                          onClick={handleSaveFirebaseConfig}
                          className="w-full bg-orange-100 hover:bg-orange-200 text-orange-800 font-bold py-1 rounded border border-orange-300 text-xs"
                       >
                          SPARA KONFIGURATION
                       </button>
                     </div>
                   )}

                   {/* Status Compare Section */}
                   {(isEnvConnected || settings.firebaseConfig) && (
                      <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                          <div className="bg-white p-2 rounded border border-orange-200 text-center">
                              <div className="text-orange-600 font-bold">LOKALT PÅ DATORN</div>
                              <div className="flex justify-center gap-3 mt-1">
                                 <div className="text-center">
                                     <div className="text-xl font-black text-slate-700">{getTotalLocalQuestions()}</div>
                                     <div className="text-[9px] text-slate-400">FRÅGOR</div>
                                 </div>
                                 <div className="text-center border-l pl-3 border-slate-100">
                                     <div className="text-xl font-black text-slate-700">{dbStats?.imageCount || 0}</div>
                                     <div className="text-[9px] text-slate-400">BILDER</div>
                                 </div>
                              </div>
                          </div>
                          <div className="bg-white p-2 rounded border border-orange-200 text-center">
                              <div className="text-orange-600 font-bold">I MOLNET (FIREBASE)</div>
                              {checkingCloud ? (
                                  <div className="mt-2 animate-pulse">...</div> 
                              ) : (
                                 <div className="flex justify-center gap-3 mt-1">
                                     <div className="text-center">
                                         <div className="text-xl font-black text-slate-700">{cloudStats?.questions !== -1 ? cloudStats?.questions : "?"}</div>
                                         <div className="text-[9px] text-slate-400">FRÅGOR</div>
                                     </div>
                                     <div className="text-center border-l pl-3 border-slate-100">
                                         <div className="text-xl font-black text-slate-700">{cloudStats?.images !== -1 ? cloudStats?.images : "?"}</div>
                                         <div className="text-[9px] text-slate-400">BILDER</div>
                                     </div>
                                 </div>
                              )}
                          </div>
                      </div>
                   )}
                   
                   <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => handleCloudSync('up')}
                        className={`flex-1 font-bold py-3 rounded-lg text-sm shadow-sm active:scale-95 transition-all ${
                           (cloudStats?.questions !== undefined && cloudStats.questions !== -1 && getTotalLocalQuestions() > cloudStats.questions) 
                           ? "bg-orange-600 hover:bg-orange-700 text-white animate-pulse" 
                           : "bg-orange-500 hover:bg-orange-600 text-white"
                        }`}
                      >
                        ⬇ SPARA TILL MOLN
                        {(cloudStats?.questions !== undefined && cloudStats.questions !== -1 && getTotalLocalQuestions() > cloudStats.questions) && (
                            <div className="text-[10px] opacity-90 font-normal">Du har osparad data!</div>
                        )}
                      </button>
                      <button
                        onClick={() => handleCloudSync('down')}
                        className="flex-1 bg-white hover:bg-orange-100 text-orange-800 font-bold py-3 rounded-lg border border-orange-300 text-sm shadow-sm active:scale-95"
                      >
                        ⬆ HÄMTA FRÅN MOLN
                      </button>
                   </div>

                   <div className="flex gap-2">
                     <button
                        onClick={handleSendTestData}
                        className="flex-1 bg-white hover:bg-red-50 text-red-800 font-bold py-2 rounded-lg text-xs border border-red-200 active:scale-95 flex items-center justify-center gap-2"
                        title="Skapa en test-post i databasen för att se att allt fungerar"
                     >
                       <span>🧪</span> SKICKA TESTDATA (PING)
                     </button>
                   </div>

                   {cloudStatus && (
                      <div className="mt-2 text-center text-xs font-bold text-orange-800 bg-white/50 p-1 rounded">
                        {cloudStatus}
                      </div>
                   )}
                </div>
                
                {/* CONTENT CONTROL - BANNED TOPICS */}
                <div className="bg-rose-50 p-4 rounded-xl border-2 border-rose-100">
                    <div className="flex justify-between items-center mb-3 border-b border-rose-200 pb-2">
                        <h3 className="font-bold text-rose-900 text-lg">3. STYRNING AV INNEHÅLL</h3>
                        
                        <button 
                            onClick={() => onUpdateSettings({ ...settings, enableBannedTopics: !settings.enableBannedTopics })}
                            className={`w-12 h-6 rounded-full transition-colors duration-300 relative flex items-center ${settings.enableBannedTopics ? 'bg-green-500' : 'bg-slate-300'}`}
                        >
                            <div 
                                className={`w-4 h-4 bg-white rounded-full shadow-md absolute transition-transform duration-300 ${settings.enableBannedTopics ? 'translate-x-7' : 'translate-x-1'}`}
                            ></div>
                        </button>
                    </div>
                    
                    <p className="text-xs text-rose-800 mb-2">
                        Här kan du ange ämnen som du vill att AI:n ska <strong>undvika</strong> att fråga om. Separera med kommatecken.
                    </p>
                    
                    <textarea
                        className={`w-full p-3 rounded border text-sm font-sans ${settings.enableBannedTopics ? 'border-rose-300 bg-white' : 'border-slate-200 bg-slate-100 text-slate-400'}`}
                        rows={4}
                        value={bannedTopicsInput}
                        onChange={(e) => setBannedTopicsInput(e.target.value)}
                        onBlur={handleSaveBannedTopics}
                        disabled={!settings.enableBannedTopics}
                        placeholder="T.ex: Hjulet, Is, Planeter..."
                    />
                    <div className="text-[10px] text-right text-rose-600 mt-1 font-bold">
                        {settings.enableBannedTopics ? "Listan är aktiv. Klicka utanför rutan för att spara." : "Blockering avstängd."}
                    </div>
                </div>

                {/* TURBO CHARGE & GENERATOR */}
                <div className="bg-amber-50 p-4 rounded-xl border-2 border-amber-100">
                   <h3 className="font-bold text-amber-900 text-lg mb-2 border-b border-amber-200 pb-2">4. TURBO-LADDA (SKAPA MED AI)</h3>
                   <p className="text-xs text-amber-800 mb-4">
                     Skapa frågor nu så din son slipper vänta! Använder <strong>AI-motorn (Nyckel i steg 1)</strong>.
                   </p>
                   
                   {/* QUESTION GENERATOR */}
                   {isGenerating ? (
                     <div className="space-y-2 mb-6">
                       <div className="flex justify-between text-xs font-bold text-amber-900">
                         <span>GENERERAR FRÅGOR... (5 sek paus)</span>
                         <span>{genProgress} / {genTarget}</span>
                       </div>
                       <div className="h-4 bg-amber-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-amber-500 transition-all duration-300" 
                            style={{ width: `${(genProgress / genTarget) * 100}%` }}
                          ></div>
                       </div>
                       {genError && (
                          <div className="bg-red-100 text-red-800 text-xs p-2 rounded border border-red-200 font-bold break-words">
                              STOPP: {genError}
                          </div>
                       )}
                     </div>
                   ) : (
                     <div className="flex gap-2 flex-col mb-4">
                       <div className="flex gap-2">
                          <button 
                            onClick={() => handleBatchGenerate(10)}
                            className="flex-1 bg-white hover:bg-amber-100 text-amber-800 font-bold py-2 rounded-lg border border-amber-300 shadow-sm active:scale-95"
                          >
                            +10 FRÅGOR
                          </button>
                          <button 
                            onClick={() => handleBatchGenerate(20)}
                            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 rounded-lg shadow-sm active:scale-95"
                          >
                            +20 FRÅGOR
                          </button>
                       </div>
                       {genError && (
                          <div className="bg-red-100 text-red-800 text-xs p-2 rounded border border-red-200 font-bold text-center break-words">
                              Senaste felet: {genError}
                          </div>
                       )}
                     </div>
                   )}

                   {/* IMAGE GENERATOR SECTION */}
                   <div className="bg-white/60 p-3 rounded-lg border border-amber-200 mt-4">
                      <h4 className="text-xs font-black text-amber-800 uppercase mb-2 flex items-center gap-2">
                         🖼️ BILD-GENERATOR
                      </h4>
                      
                      {isGeneratingImages ? (
                          <div className="space-y-2">
                              <div className="flex justify-between text-xs font-bold text-amber-900">
                                  <span>MÅLAR BILDER... (Tar tid!)</span>
                                  <span>{imgGenProgress} / {missingImagesCount}</span>
                              </div>
                              <div className="h-4 bg-amber-200 rounded-full overflow-hidden">
                                  <div 
                                      className="h-full bg-purple-500 transition-all duration-300" 
                                      style={{ width: `${(imgGenProgress / missingImagesCount) * 100}%` }}
                                  ></div>
                              </div>
                              <p className="text-[10px] text-amber-700 text-center">Sparar automatiskt till molnet...</p>
                          </div>
                      ) : (
                          <>
                              <div className="text-xs text-amber-900 mb-2">
                                  {missingImagesCount > 0 
                                      ? `Du har ${missingImagesCount} frågor som saknar bilder.` 
                                      : "Alla dina frågor har bilder! 🎉"}
                              </div>
                              
                              <button
                                  onClick={handleGenerateMissingImages}
                                  disabled={missingImagesCount === 0}
                                  className="w-full bg-purple-100 hover:bg-purple-200 text-purple-800 font-bold py-2 rounded-lg border border-purple-300 shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                  {missingImagesCount > 0 ? `🎨 GENERERA ${missingImagesCount} BILDER` : "INGET ATT GENERERA"}
                              </button>
                              <p className="text-[9px] text-slate-500 mt-1 text-center">
                                 OBS: Tar ca 5 sekunder per bild. Använd för att fylla upp din databas.
                              </p>
                          </>
                      )}
                   </div>

                </div>

                {/* LOCAL KNOWLEDGE & STATS */}
                <div className="bg-indigo-50 p-4 rounded-xl border-2 border-indigo-100">
                  <h3 className="font-bold text-slate-800 text-lg mb-4 border-b border-indigo-200 pb-2">DIN SPARADE KUNSKAP (LOKALT)</h3>
                  
                  {dbStats ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div className="bg-white p-2 rounded-lg shadow-sm flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">MATTE</span>
                            <span className="font-bold text-indigo-600">{dbStats.mathCount}</span>
                        </div>
                        <div className="bg-white p-2 rounded-lg shadow-sm flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">SVENSKA</span>
                            <span className="font-bold text-indigo-600">{dbStats.languageCount}</span>
                        </div>
                        <div className="bg-white p-2 rounded-lg shadow-sm flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">LOGIK</span>
                            <span className="font-bold text-indigo-600">{dbStats.logicCount}</span>
                        </div>
                        <div className="bg-white p-2 rounded-lg shadow-sm flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">FYSIK</span>
                            <span className="font-bold text-indigo-600">{dbStats.physicsCount}</span>
                        </div>
                      </div>
                      
                      {/* Image & Storage Stats */}
                      <div className="bg-white p-3 rounded-lg shadow-sm border border-indigo-200 mb-6">
                         <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-slate-500 uppercase">Bilder & Minne (LOKALT)</span>
                            <span className="text-xs font-bold bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                              {dbStats.imageCount} / 50 Cachat (Resten i molnet)
                            </span>
                         </div>
                         
                         {storageEst && (
                           <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                                 <span>Använt utrymme: {formatBytes(storageEst.usage)}</span>
                                 <span>Max: {formatBytes(storageEst.quota)}</span>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                 <div 
                                    className={`h-full transition-all duration-500 ${storageEst.percent > 80 ? 'bg-red-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${Math.max(1, storageEst.percent)}%` }}
                                 ></div>
                              </div>
                           </div>
                         )}
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-sm text-slate-400 mb-4">Läser in statistik...</div>
                  )}
                  
                  <div className="flex gap-4 flex-col sm:flex-row">
                    <button 
                      onClick={handleExport}
                      className="flex-1 bg-white hover:bg-indigo-50 text-indigo-700 font-bold py-2 px-4 rounded-lg border-2 border-indigo-200 shadow-sm active:scale-95 transition-all flex justify-center items-center gap-2"
                    >
                      <span>💾</span> FIL-BACKUP
                    </button>
                    
                    <label className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm active:scale-95 transition-all cursor-pointer flex justify-center items-center gap-2">
                      <span>📂</span> LÄS IN FIL
                      <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                  </div>
                  {backupStatus && (
                    <div className="mt-2 text-center text-sm font-bold text-indigo-800 animate-pulse">
                      {backupStatus}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
