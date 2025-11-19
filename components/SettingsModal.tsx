import React, { useState, useEffect } from 'react';
import { AppSettings, Subject, FirebaseConfig } from '../types';
import { trainDb, DbStats } from '../services/db';
import { testApiKey, batchGenerateQuestions } from '../services/geminiService';

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
  const [backupStatus, setBackupStatus] = useState<string>("");
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [cloudStatus, setCloudStatus] = useState<string>("");
  const [tempFirebaseConfig, setTempFirebaseConfig] = useState<string>("");
  
  // Generator State
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genTarget, setGenTarget] = useState(0);

  const hasKey = Boolean(process.env.API_KEY);
  const isEnvConnected = trainDb.isCloudConnected();

  // Initialize DB cloud connection if settings exist manually
  useEffect(() => {
    if (!isEnvConnected && settings.firebaseConfig) {
      trainDb.initCloud(settings.firebaseConfig);
    }
    trainDb.getDatabaseStats().then(setDbStats);
    
    if (settings.firebaseConfig) {
        setTempFirebaseConfig(JSON.stringify(settings.firebaseConfig, null, 2));
    }
  }, [settings.firebaseConfig, isEnvConnected]);

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

  const handleBatchGenerate = async (count: number) => {
    setIsGenerating(true);
    setGenTarget(count);
    setGenProgress(0);
    
    await batchGenerateQuestions(count, settings.useDigits, settings.subjectDifficulty, (done) => {
      setGenProgress(done);
    });
    
    setIsGenerating(false);
    trainDb.getDatabaseStats().then(setDbStats);
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
    setConnectionStatus('testing');
    const success = await testApiKey();
    setConnectionStatus(success ? 'success' : 'error');
    setTimeout(() => setConnectionStatus('idle'), 5000);
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
        setCloudStatus(`Skickade ${count} frågor till molnet!`);
      } else {
        const count = await trainDb.syncCloudToLocal();
        setCloudStatus(`Hämtade ${count} frågor från molnet!`);
      }
      trainDb.getDatabaseStats().then(setDbStats);
    } catch (e: any) {
      console.error(e);
      setCloudStatus("Fel: " + e.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border-4 border-blue-200 p-6 relative animate-bounce-in my-8">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full p-2 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <h2 className="text-2xl font-bold text-blue-900 mb-6 flex items-center gap-3">
          ⚙️ INSTÄLLNINGAR
        </h2>

        <div className="space-y-8">
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

          <div className="bg-amber-50 p-4 rounded-xl border-2 border-amber-100">
             <h3 className="font-bold text-amber-900 text-lg mb-2 border-b border-amber-200 pb-2">⚡ TURBO-LADDA DATABASEN</h3>
             <p className="text-xs text-amber-800 mb-4">
               Skapa frågor nu så din son slipper vänta! Frågorna sparas i din webbläsare.
             </p>
             
             {isGenerating ? (
               <div className="space-y-2">
                 <div className="flex justify-between text-xs font-bold text-amber-900">
                   <span>GENERERAR FRÅGOR...</span>
                   <span>{genProgress} / {genTarget}</span>
                 </div>
                 <div className="h-4 bg-amber-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500 transition-all duration-300" 
                      style={{ width: `${(genProgress / genTarget) * 100}%` }}
                    ></div>
                 </div>
               </div>
             ) : (
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
             )}
          </div>

          {/* CLOUD SYNC SECTION - FIREBASE */}
          <div className="bg-orange-50 p-4 rounded-xl border-2 border-orange-100">
             <h3 className="font-bold text-orange-900 text-lg mb-2 border-b border-orange-200 pb-2">🔥 MOLN-KOPPLING (FIREBASE)</h3>
             <p className="text-xs text-orange-800 mb-4">
               Spara frågor säkert i Googles moln. Använd <code>.env.local</code> för att slippa skriva in nyckeln här.
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
             
             <div className="flex gap-2">
                <button
                  onClick={() => handleCloudSync('up')}
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-lg text-sm shadow-sm active:scale-95"
                >
                  ⬇ SPARA TILL MOLN
                </button>
                <button
                  onClick={() => handleCloudSync('down')}
                  className="flex-1 bg-white hover:bg-orange-100 text-orange-800 font-bold py-2 rounded-lg border border-orange-300 text-sm shadow-sm active:scale-95"
                >
                  ⬆ HÄMTA FRÅN MOLN
                </button>
             </div>
             {cloudStatus && (
                <div className="mt-2 text-center text-xs font-bold text-orange-800">
                  {cloudStatus}
                </div>
             )}
          </div>

          <div className="bg-indigo-50 p-4 rounded-xl border-2 border-indigo-100">
            <h3 className="font-bold text-slate-800 text-lg mb-4 border-b border-indigo-200 pb-2">DIN SPARADE KUNSKAP</h3>
            
            {dbStats ? (
              <div className="grid grid-cols-2 gap-2 mb-6">
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
                 <div className="col-span-2 bg-indigo-100 p-2 rounded-lg shadow-sm flex justify-between items-center border border-indigo-200">
                    <span className="text-xs font-bold text-indigo-800 uppercase">SPARADE BILDER (OFFLINE)</span>
                    <span className="font-bold text-indigo-800">{dbStats.imageCount}</span>
                 </div>
              </div>
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
          
          <div className="flex flex-col gap-3 pt-4 border-t-2 border-blue-100">
             <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-center space-y-3">
                <div className="text-xs text-slate-500 flex justify-center gap-2">
                   API-NYCKEL: 
                   <span className={hasKey ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                     {hasKey ? "AKTIV" : "SAKNAS"}
                   </span>
                </div>
                <button 
                  onClick={handleTestConnection}
                  disabled={connectionStatus === 'testing'}
                  className={`w-full py-2 px-4 rounded-lg text-sm font-bold transition-colors flex justify-center items-center gap-2 ${
                    connectionStatus === 'success' ? 'bg-green-100 text-green-700 border border-green-300' :
                    connectionStatus === 'error' ? 'bg-red-100 text-red-700 border border-red-300' :
                    'bg-white text-blue-600 border border-blue-200 hover:bg-blue-100'
                  }`}
                >
                  {connectionStatus === 'idle' && "📡 TESTA ANSLUTNING"}
                  {connectionStatus === 'testing' && "KONTROLLERAR..."}
                  {connectionStatus === 'success' && "✅ ALLT FUNGERAR!"}
                  {connectionStatus === 'error' && "❌ FEL PÅ NYCKELN"}
                </button>

                {/* NEW SECURITY TIP */}
                {hasKey && (
                  <p className="text-[10px] text-slate-400 leading-tight mt-2">
                    🔒 För maximal säkerhet: Gå till Google Cloud Console och begränsa nyckeln till din webbplats-adress (Website Restrictions).
                  </p>
                )}
             </div>
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <button 
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg active:scale-95 transition-all w-full sm:w-auto"
          >
            STÄNG
          </button>
        </div>
      </div>
    </div>
  );
};