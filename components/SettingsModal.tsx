
import React, { useState, useEffect } from 'react';
import { AppSettings, Subject, FirebaseConfig, LevelStats, DbStats } from '../types';
import { trainDb, StorageEstimate, CloudStats } from '../services/db';
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
  const [view, setView] = useState<'MAIN' | 'ADVANCED'>('MAIN');
  
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [storageEst, setStorageEst] = useState<StorageEstimate | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionErrorMsg, setConnectionErrorMsg] = useState<string>("");
  const [cloudStatus, setCloudStatus] = useState<string>("");
  const [tempFirebaseConfig, setTempFirebaseConfig] = useState<string>("");
  
  // Cleanup State
  const [isCleaning, setIsCleaning] = useState(false);

  // Banned Topics State for editing
  const [bannedTopicsInput, setBannedTopicsInput] = useState<string>("");
  
  // Load persisted key for display
  const [manualKey, setManualKey] = useState<string>("");
  
  useEffect(() => {
      const savedKey = localStorage.getItem('trainMasterApiKey');
      if (savedKey) setManualKey(savedKey);
      
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
  
  // Turbo Selection
  const [turboSubject, setTurboSubject] = useState<Subject>(Subject.MATH);
  const [turboLevel, setTurboLevel] = useState<number>(1);

  // Image Generator State
  const [missingImagesCount, setMissingImagesCount] = useState<number>(0);
  const [missingImagePrompts, setMissingImagePrompts] = useState<string[]>([]);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imgGenProgress, setImgGenProgress] = useState(0);

  // Key Source Info
  const keyDebug = getApiKeyDebug();
  const keySource = getKeySource(); 
  const isBlocked = isEnvKeyBlocked();
  const hasKey = keySource !== 'NONE';

  const isEnvConnected = trainDb.isCloudConnected();

  useEffect(() => {
    if (!isEnvConnected && settings.firebaseConfig) {
      trainDb.initCloud(settings.firebaseConfig);
    }
    
    refreshLocalStats();
    
    if (settings.firebaseConfig) {
        setTempFirebaseConfig(JSON.stringify(settings.firebaseConfig, null, 2));
    }

    if (trainDb.isCloudConnected()) {
      refreshCloudStats();
    }
  }, [settings.firebaseConfig, isEnvConnected]);

  const refreshLocalStats = () => {
    trainDb.getDatabaseStats().then(setDbStats);
    trainDb.getStorageEstimate().then(setStorageEst);
    
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
        },
        turboSubject, // Targeted subject
        turboLevel    // Targeted level
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
        setBackupStatus("Filen var felaktig.");
      }
    };
    reader.readAsText(file);
  };

  const handleTestConnection = async () => {
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
     setConnectionStatus('idle'); 
  };

  const handleSaveFirebaseConfig = () => {
    try {
        const config = JSON.parse(tempFirebaseConfig);
        onUpdateSettings({ ...settings, firebaseConfig: config });
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
        await trainDb.syncLocalToCloud();
        setCloudStatus(`Skickade frågor och bilder till molnet!`);
      } else {
        const count = await trainDb.syncCloudToLocal();
        setCloudStatus(`Hämtade ${count} frågor från molnet!`);
      }
      refreshLocalStats();
      refreshCloudStats();
    } catch (e: any) {
      setCloudStatus("Fel: " + e.message);
    }
  };

  const handleCleanupCloud = async (useAi: boolean = false) => {
    if (!confirm(useAi 
       ? "Detta använder AI för att läsa igenom alla frågor och ta bort dubbletter i molnet. Det tar en stund. Är du säker?" 
       : "Är du säker? Detta raderar exakta text-dubbletter från moln-databasen.")) return;
    
    setCloudStatus(useAi ? "Startar AI-analys..." : "Letar dubbletter i molnet...");
    setIsCleaning(true);
    try {
      let deleted = 0;
      if (useAi) {
         deleted = await trainDb.cleanupDuplicatesCloudAI((msg) => setCloudStatus(msg));
      } else {
         deleted = await trainDb.cleanupDuplicatesCloud();
      }
      setCloudStatus(`Städning klar! Raderade ${deleted} dubbletter.`);
      refreshCloudStats();
    } catch (e: any) {
      setCloudStatus("Fel vid städning: " + e.message);
    }
    setIsCleaning(false);
  };

  const handleCleanupLocal = async () => {
    if (!confirm("Är du säker? Detta rensar dubbletter från webbläsarens minne.")) return;
    setBackupStatus("Städar lokalt...");
    try {
      const deleted = await trainDb.cleanupDuplicatesLocal();
      setBackupStatus(`Klart! Tog bort ${deleted} dubbletter.`);
      refreshLocalStats();
    } catch (e: any) {
      setBackupStatus("Fel: " + e.message);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Renders the stat table row for a subject
  const renderStatRow = (label: string, stats: LevelStats) => (
    <div className="flex items-center justify-between py-1 border-b border-slate-100 text-xs">
      <div className="w-24 font-bold text-slate-600">{label}</div>
      <div className="flex-1 flex justify-between px-2">
         {[1, 2, 3, 4, 5].map(lvl => (
           <span key={lvl} className={`w-8 text-center ${stats.byLevel[lvl] > 150 ? 'text-green-600 font-bold' : stats.byLevel[lvl] > 50 ? 'text-yellow-600' : 'text-red-400'}`}>
             {stats.byLevel[lvl] || 0}
           </span>
         ))}
      </div>
      <div className="w-10 text-right font-bold text-slate-800">{stats.total}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border-4 border-blue-200 p-6 relative animate-bounce-in my-8">
          
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full p-2 transition-colors z-10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>

          <h2 className="text-2xl font-bold text-blue-900 mb-6 flex items-center gap-3 uppercase">
            {view === 'MAIN' ? '⚙️ INSTÄLLNINGAR' : '🔧 AVANCERADE INSTÄLLNINGAR'}
          </h2>

          <div className="space-y-6">
            
            {view === 'MAIN' && (
              <>
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl border-2 border-blue-100">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">STORA BOKSTÄVER</h3>
                    <p className="text-slate-500 text-sm">Gör all text lättare att läsa</p>
                  </div>
                  <button 
                    onClick={() => onUpdateSettings({ ...settings, useUppercase: !settings.useUppercase })}
                    className={`w-16 h-8 rounded-full transition-colors duration-300 relative flex items-center ${settings.useUppercase ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <div className={`w-6 h-6 bg-white rounded-full shadow-md absolute transition-transform duration-300 ${settings.useUppercase ? 'translate-x-9' : 'translate-x-1'}`}></div>
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
                    <div className={`w-6 h-6 bg-white rounded-full shadow-md absolute transition-transform duration-300 ${settings.useDigits ? 'translate-x-9' : 'translate-x-1'}`}></div>
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
                          > - </button>
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
                          > + </button>
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
                  <button onClick={onClose} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg active:scale-95 transition-all w-full">STÄNG</button>
                </div>
              </>
            )}

            {view === 'ADVANCED' && (
              <div className="space-y-8">
                <button onClick={() => setView('MAIN')} className="text-slate-500 hover:text-blue-600 font-bold flex items-center gap-2 mb-4 uppercase text-sm">⬅ Tillbaka</button>

                {/* AI KEY SECTION */}
                <div className="flex flex-col gap-3 border-b-2 border-blue-100 pb-6">
                   <h3 className="font-bold text-slate-800 text-lg">1. AI-MOTORN (Gemini)</h3>
                   <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center space-y-3">
                      <div className="flex items-center justify-between bg-white p-2 rounded border border-blue-100">
                        <div className="text-left">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">AKTIV NYCKEL</div>
                          <div className={hasKey ? "text-slate-700 font-mono font-bold" : "text-red-600 font-bold"}>{keyDebug}</div>
                        </div>
                        <div className="text-right">
                           <div className="text-[10px] text-slate-400 uppercase font-bold">KÄLLA</div>
                           <div className="font-bold text-xs text-blue-700">{keySource}</div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-1 mt-2 border-t border-blue-100 pt-3">
                        <label className="text-xs font-bold text-slate-500 uppercase text-left">Mata in nyckel manuellt:</label>
                        <input type="password" value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="Klistra in API-nyckel..." className="w-full p-2 rounded border border-blue-200 text-sm font-mono" />
                      </div>
                      <button onClick={handleTestConnection} disabled={connectionStatus === 'testing'} className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg text-sm">
                          {connectionStatus === 'testing' ? "KONTROLLERAR..." : "SPARA & TESTA"}
                      </button>
                      
                      {connectionStatus === 'success' && <div className="text-green-600 text-xs font-bold">ANSLUTNING LYCKADES!</div>}
                      {connectionStatus === 'error' && <div className="text-red-500 text-xs font-bold">ANSLUTNING MISSLYCKADES: {connectionErrorMsg}</div>}

                   </div>
                </div>

                {/* LOCAL KNOWLEDGE & STATS */}
                <div className="bg-indigo-50 p-4 rounded-xl border-2 border-indigo-100">
                  <h3 className="font-bold text-slate-800 text-lg mb-2 border-b border-indigo-200 pb-2">DIN DATABAS (LOKALT)</h3>
                  
                  {dbStats ? (
                    <div className="bg-white rounded-lg border border-indigo-200 p-2 mb-4">
                        <div className="flex justify-between px-2 text-[10px] font-bold text-slate-400 mb-1 border-b border-slate-100 pb-1">
                           <span className="w-24">ÄMNE</span>
                           <span className="flex-1 flex justify-between">
                              <span>L1</span><span>L2</span><span>L3</span><span>L4</span><span>L5</span>
                           </span>
                           <span className="w-10 text-right">TOT</span>
                        </div>
                        {renderStatRow('MATTE', dbStats.math)}
                        {renderStatRow('SVENSKA', dbStats.language)}
                        {renderStatRow('LOGIK', dbStats.logic)}
                        {renderStatRow('TEKNIK', dbStats.physics)}
                        
                        <div className="mt-2 text-[10px] text-center text-slate-400">
                           L = Svårighetsnivå (1-5)
                        </div>
                    </div>
                  ) : (
                    <div className="text-center text-sm text-slate-400 mb-4">Läser in statistik...</div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    
                    <label className="col-span-2 bg-white hover:bg-blue-50 text-blue-700 font-bold py-2 px-4 rounded-lg border-2 border-blue-200 text-xs shadow-sm cursor-pointer text-center flex items-center justify-center gap-2">
                       📁 IMPORTERA BACKUP
                       <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                    </label>
                    <button onClick={handleExport} className="col-span-2 bg-white hover:bg-blue-50 text-blue-700 font-bold py-2 px-4 rounded-lg border-2 border-blue-200 text-xs shadow-sm">💾 EXPORTERA BACKUP</button>
                    {backupStatus && <div className="col-span-2 text-center text-xs font-bold text-slate-500">{backupStatus}</div>}
                    
                    <div className="col-span-2 border-t border-indigo-200 my-2"></div>

                    <button onClick={handleCleanupLocal} className="col-span-2 bg-white hover:bg-red-50 text-red-700 font-bold py-2 px-4 rounded-lg border-2 border-red-200 text-xs shadow-sm">STÄDA DUBBLETTER (LOKALT)</button>
                  </div>
                </div>

                {/* TURBO CHARGE & GENERATOR */}
                <div className="bg-amber-50 p-4 rounded-xl border-2 border-amber-100">
                   <h3 className="font-bold text-amber-900 text-lg mb-2 border-b border-amber-200 pb-2">TURBO-LADDA (SKAPA FRÅGOR)</h3>
                   
                   {isGenerating ? (
                     <div className="space-y-2 mb-6">
                       <div className="flex justify-between text-xs font-bold text-amber-900">
                         <span>GENERERAR...</span>
                         <span>{genProgress} / {genTarget}</span>
                       </div>
                       <div className="h-4 bg-amber-200 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${(genProgress / genTarget) * 100}%` }}></div>
                       </div>
                     </div>
                   ) : (
                     <div className="flex flex-col gap-3 mb-4">
                       <div className="flex gap-2">
                          <select 
                             value={turboSubject} 
                             onChange={(e) => setTurboSubject(e.target.value as Subject)}
                             className="flex-1 p-2 rounded border border-amber-300 text-sm font-bold text-slate-700"
                          >
                             {Object.keys(SUBJECT_LABELS).map(k => (
                                <option key={k} value={k}>{SUBJECT_LABELS[k as Subject]}</option>
                             ))}
                          </select>
                          <select 
                             value={turboLevel} 
                             onChange={(e) => setTurboLevel(Number(e.target.value))}
                             className="w-24 p-2 rounded border border-amber-300 text-sm font-bold text-slate-700"
                          >
                             {[1,2,3,4,5].map(l => <option key={l} value={l}>Nivå {l}</option>)}
                          </select>
                       </div>
                       
                       <button 
                            onClick={() => handleBatchGenerate(20)}
                            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 rounded-lg shadow-sm active:scale-95"
                       >
                            +20 FRÅGOR (Vald Nivå)
                       </button>
                       
                       {genError && <div className="bg-red-100 text-red-800 text-xs p-2 rounded">{genError}</div>}
                     </div>
                   )}

                   <div className="bg-white/60 p-3 rounded-lg border border-amber-200 mt-4">
                      <div className="flex justify-between items-center mb-2">
                          <h4 className="text-xs font-black text-amber-800 uppercase">BILD-GENERATOR</h4>
                          <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 rounded">{missingImagesCount} saknas</span>
                      </div>
                      <button
                          onClick={handleGenerateMissingImages}
                          disabled={missingImagesCount === 0 || isGeneratingImages}
                          className="w-full bg-purple-100 hover:bg-purple-200 text-purple-800 font-bold py-2 rounded-lg border border-purple-300 text-xs"
                      >
                          {isGeneratingImages ? `GENERERAR ${imgGenProgress}...` : "SKAPA BILDER"}
                      </button>
                   </div>
                </div>

                {/* CLOUD SYNC */}
                <div className="bg-orange-50 p-4 rounded-xl border-2 border-orange-100">
                   <h3 className="font-bold text-orange-900 text-lg mb-2 border-b border-orange-200 pb-2">MOLNET (FIREBASE)</h3>
                   
                   {/* Connection Status / Config */}
                   <div className="mb-4 text-xs">
                      <div className="flex justify-between mb-2 font-bold text-orange-800">
                         <span>STATUS: {trainDb.isCloudConnected() ? "ANSLUTEN ✅" : "EJ ANSLUTEN ❌"}</span>
                         {cloudStats && <span>{cloudStats.questions} Frågor | {cloudStats.images} Bilder</span>}
                      </div>
                      
                      {!trainDb.isCloudConnected() && (
                          <div className="mb-2">
                              <textarea 
                                  value={tempFirebaseConfig}
                                  onChange={(e) => setTempFirebaseConfig(e.target.value)}
                                  placeholder="{ apiKey: '...', ... }"
                                  className="w-full p-2 rounded border border-orange-200 font-mono text-[10px] h-20"
                              />
                              <button onClick={handleSaveFirebaseConfig} className="bg-orange-600 text-white px-3 py-1 rounded font-bold mt-1 w-full">SPARA KONFIGURATION</button>
                          </div>
                      )}
                   </div>

                   {/* Sync Actions */}
                   <div className="grid grid-cols-2 gap-2 mb-4">
                        <button 
                          onClick={() => handleCloudSync('up')}
                          className="bg-orange-200 hover:bg-orange-300 text-orange-900 font-bold py-2 rounded border border-orange-300 text-xs flex flex-col items-center"
                        >
                           <span>⬆ SKICKA TILL MOLNET</span>
                           <span className="text-[9px] opacity-70 font-normal">(Spara din data säkert)</span>
                        </button>
                        <button 
                          onClick={() => handleCloudSync('down')}
                          className="bg-orange-200 hover:bg-orange-300 text-orange-900 font-bold py-2 rounded border border-orange-300 text-xs flex flex-col items-center"
                        >
                           <span>⬇ HÄMTA FRÅN MOLNET</span>
                           <span className="text-[9px] opacity-70 font-normal">(Få nya frågor)</span>
                        </button>
                   </div>

                   <div className="space-y-2 mb-4 border-t border-orange-200 pt-2">
                        <button
                            onClick={() => handleCleanupCloud(true)}
                            disabled={isCleaning}
                            className="w-full bg-purple-100 hover:bg-purple-200 text-purple-900 font-bold py-2 rounded-lg text-xs border border-purple-300 shadow-sm"
                        >
                        <span>🧠</span> {isCleaning ? "ANALYZERAR..." : "AI-STÄDNING AV MOLNET (SMART)"}
                        </button>
                        <p className="text-[9px] text-center text-orange-800 opacity-70">
                           Tar bort dubbletter men behåller variationer och olika nivåer.
                        </p>
                   </div>
                   
                   {cloudStatus && <div className="mt-2 text-center text-xs font-bold text-orange-800 bg-white/50 p-2 rounded border border-orange-200">{cloudStatus}</div>}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}