
import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Subject, Question, QuestionType } from "../types";
import { trainDb } from "./db";

const STORAGE_KEY_API = 'trainMasterApiKey';
const STORAGE_KEY_BLOCK_ENV = 'trainMasterBlockEnv';

// Helper to clean key if user accidentally pasted quotes in Vercel
const getCleanApiKey = () => {
  // 0. Check if user has explicitly blocked the environment key
  let blockEnv = false;
  if (typeof window !== 'undefined') {
    blockEnv = localStorage.getItem(STORAGE_KEY_BLOCK_ENV) === 'true';
  }

  // 1. Try LocalStorage first (Persistent manual override)
  if (typeof window !== 'undefined') {
      const local = localStorage.getItem(STORAGE_KEY_API);
      if (local && local.length > 10) return local.trim();
  }

  if (blockEnv) return "";

  // 2. Try Injected Process Env (via vite.config.ts define) - Handles GOOGLE_AI_API_KEY
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env && process.env.GOOGLE_AI_API_KEY) {
    // @ts-ignore
    return process.env.GOOGLE_AI_API_KEY.trim();
  }

  // 3. Try Standard Vite Environment Variable (VITE_GOOGLE_AI_API_KEY)
  // @ts-ignore
  if (import.meta.env && import.meta.env.VITE_GOOGLE_AI_API_KEY) {
    // @ts-ignore
    return import.meta.env.VITE_GOOGLE_AI_API_KEY.trim();
  }
  
  // Fallback alias
  // @ts-ignore
  if (import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) {
     // @ts-ignore
    return import.meta.env.VITE_GEMINI_API_KEY.trim();
  }

  return "";
};

let apiKey = getCleanApiKey();
let ai = new GoogleGenAI({ apiKey: apiKey });

export const getKeySource = (): 'MANUAL' | 'ENV_VITE' | 'ENV_PROCESS' | 'NONE' => {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem(STORAGE_KEY_API);
    if (local && local.length > 10) return 'MANUAL';
  }
  
  // Check if blocked
  let blockEnv = false;
  if (typeof window !== 'undefined') {
    blockEnv = localStorage.getItem(STORAGE_KEY_BLOCK_ENV) === 'true';
  }

  if (!blockEnv) {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env && process.env.GOOGLE_AI_API_KEY) return 'ENV_PROCESS';
    // @ts-ignore
    if (import.meta.env && (import.meta.env.VITE_GOOGLE_AI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY)) return 'ENV_VITE';
  }
  
  return 'NONE';
};

export const isEnvKeyBlocked = (): boolean => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(STORAGE_KEY_BLOCK_ENV) === 'true';
  }
  return false;
};

export const toggleBlockEnvKey = (shouldBlock: boolean) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_BLOCK_ENV, String(shouldBlock));
    // Re-eval key
    apiKey = getCleanApiKey();
    ai = new GoogleGenAI({ apiKey: apiKey });
  }
};

export const setRuntimeApiKey = (newKey: string) => {
  const cleaned = newKey.trim();
  apiKey = cleaned;
  
  // Persist to local storage so it survives refresh
  if (typeof window !== 'undefined') {
      if (cleaned.length > 0) {
          localStorage.setItem(STORAGE_KEY_API, cleaned);
      } else {
          localStorage.removeItem(STORAGE_KEY_API);
      }
  }

  // Re-initialize the client with the new key
  ai = new GoogleGenAI({ apiKey: apiKey });
};

export const clearRuntimeApiKey = () => {
  apiKey = getCleanApiKey(); // Will revert to Env key if not blocked, or empty if blocked
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_API);
  }
  // Re-eval
  apiKey = getCleanApiKey();
  ai = new GoogleGenAI({ apiKey: apiKey });
};

// In-memory fallback only used for very first load if DB is empty and API fails
const imageCache = new Map<string, string>(); // Keep a small RAM cache for immediate reuse in session

// --- AUDIO CONTEXT FOR TTS ---
let audioContext: AudioContext | null = null;

// --- HELPER: DEBUG KEY ---
export const getApiKeyDebug = (): string => {
  if (!apiKey) return "SAKNAS";
  if (apiKey.length < 5) return "*****";
  return "..." + apiKey.slice(-4);
};

// --- FALLBACK QUESTIONS (Static safety net) ---
const FALLBACK_QUESTIONS: Omit<Question, 'id'>[] = [
  {
    type: 'MULTIPLE_CHOICE',
    text: "VILKEN PLANET ÄR NÄRMAST SOLEN?",
    options: ["JORDEN", "MARS", "MERKURIUS", "VENUS"],
    correctAnswerIndex: 2,
    explanation: "MERKURIUS ÄR DEN MINSTA OCH NÄRMASTE PLANETEN.",
    difficultyLevel: 2,
    visualSubject: "Planet Mercury in space"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VAD BLIR 5 + 5?",
    options: ["8", "9", "10", "11"],
    correctAnswerIndex: 2,
    explanation: "5 PLUS 5 ÄR LIKA MED 10. DU HAR 10 FINGRAR!",
    difficultyLevel: 1,
    visualSubject: undefined
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VILKET AV DESSA ÄR INTE ETT DJUR?",
    options: ["KATT", "HUND", "BUSS", "HÄST"],
    correctAnswerIndex: 2,
    explanation: "EN BUSS ÄR ETT FORDON, INTE ETT DJUR.",
    difficultyLevel: 1,
    visualSubject: "A yellow bus"
  }
];

const questionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    questionText: { type: Type.STRING, description: "The question text in SWEDISH, UPPERCASE only. Direct question, no greetings." },
    options: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "4 possible answers in UPPERCASE."
    },
    correctAnswerIndex: { type: Type.INTEGER, description: "Index (0-3) of the correct answer." },
    explanation: { type: Type.STRING, description: "Short explanation in UPPERCASE." },
    visualSubject: { 
      type: Type.STRING, 
      description: "Visual description of the CORRECT answer if it is a physical object/animal (e.g. 'A green T-Rex dinosaur', 'The planet Saturn'). Keep it simple and cute. Leave empty/null if abstract (math numbers, logic concepts)." 
    }
  },
  required: ["questionText", "options", "correctAnswerIndex", "explanation"],
};

// Expanded topics to avoid repetition
const SUB_TOPICS: Record<Subject, string[]> = {
  [Subject.MATH]: [
    "RÄKNA ANTAL (Textbaserat: 'Lisa har 2 äpplen och får 3 till...')",
    "ENKEL ADDITION (Plus)",
    "ENKEL SUBTRAKTION (Minus)",
    "KLOCKAN OCH TID",
    "PENGAR OCH HANDLA I AFFÄR",
    "GEOMETRISKA FORMER (2D och 3D)",
    "MÖNSTER I TALSERIER (2, 4, 6...)",
    "DUBBELT OCH HÄLFTEN",
    "STORLEKSORDNING (Minst till störst)",
    "MATEMATIK I SPORT (Mål, poäng)",
    "MÄTA SAKER (Längd, vikt)"
  ],
  [Subject.LANGUAGE]: [
    "RIM OCH RAMSOR",
    "MOTSATSORD",
    "SYNONYMER",
    "SAMMANSATTA ORD",
    "VILKEN BOKSTAV BÖRJAR ORDET PÅ?",
    "STAVNING",
    "LISTA UT ORDET (Gåtor)",
    "ORDKUNSKAP (Vad är en...)",
    "ADJEKTIV (Beskrivande ord)",
    "VERB (Vad gör man?)"
  ],
  [Subject.LOGIC]: [
    "VAD SKA BORT? (Udda fågel - textbaserat)",
    "FORMMÖNSTER (Vad kommer sen?)",
    "ORSAK OCH VERKAN",
    "SORTERING (Kategorier)",
    "SPATIAL FÖRMÅGA (Pusselbitar)",
    "GÅTOR OCH KLURINGAR",
    "PROGRAMMERINGSTÄNK (Steg för steg)",
    "LABYRINTER (Höger/Vänster)"
  ],
  [Subject.PHYSICS]: [
    "RYMDEN OCH PLANETER (Inte bara solen)",
    "DJUR I HAVET",
    "INSEKTER OCH SMÅKRYP",
    "SKELETTET OCH MUSKLER (Inte hjärta/blod)",
    "ELEKTRICITET OCH LAMPOR",
    "MAGNETISM",
    "VÄDER (Regn, Åska, Moln)",
    "DINOSAURIER",
    "MATERIAL (Trä, Metall, Plast)",
    "VERKTYG OCH BYGGANDE",
    "MUSIKINSTRUMENT (Ljudvågor)",
    "FORSKNING OCH UPPFINNINGAR"
  ]
};

const generateDragDropQuestion = (difficulty: number): Question => {
  const items = [
    { emoji: '🐮', name: 'KOSSOR', container: 'BOSKAPSVAGNEN', source: 'LASTKAJEN', verb: 'LASTA PÅ' },
    { emoji: '📦', name: 'LÅDOR', container: 'GODSVAGNEN', source: 'LASTKAJEN', verb: 'LASTA PÅ' },
    { emoji: '🪵', name: 'TIMMER', container: 'TIMMERVAGNEN', source: 'LASTKAJEN', verb: 'LASTA PÅ' },
    { emoji: '🧳', name: 'VÄSKOR', container: 'PASSAGERARVAGNEN', source: 'PERRONGEN', verb: 'LASTA PÅ' },
    { emoji: '⚙️', name: 'KUGGHJUL', container: 'VERKSTADSVAGNEN', source: 'VERKSTADEN', verb: 'LÄMNA' },
    { emoji: '🍽️', name: 'TALLRIKAR', container: 'BISTRO-BORDET', source: 'KÖKSLUCKAN', verb: 'DUKA FRAM' },
    { emoji: '🥤', name: 'MUGGAR', container: 'BORDET', source: 'DISKEN', verb: 'STÄLL FRAM' },
    { emoji: '🥄', name: 'SKEDAR', container: 'BORDET', source: 'LÅDAN', verb: 'DUKA FRAM' },
    { emoji: '🍎', name: 'ÄPPLEN', container: 'FRUKTSKÅLEN', source: 'KORGEN', verb: 'LÄGG I' }
  ];

  const selectedItem = items[Math.floor(Math.random() * items.length)];
  const targetCount = difficulty === 1 
    ? Math.floor(Math.random() * 5) + 1 
    : Math.floor(Math.random() * 7) + 4;
  
  const totalItems = targetCount + Math.floor(Math.random() * 4) + 2; 

  return {
    id: crypto.randomUUID(),
    type: 'DRAG_AND_DROP',
    text: `${selectedItem.verb} ${targetCount} ST ${selectedItem.name}.`,
    explanation: `BRA JOBBAT! NU ÄR DET KLART.`,
    difficultyLevel: difficulty,
    dragDropConfig: {
      itemEmoji: selectedItem.emoji,
      targetCount: targetCount,
      totalItems: totalItems,
      containerName: selectedItem.container,
      sourceName: selectedItem.source,
      verb: selectedItem.verb
    }
  };
};

export const testApiKey = async (): Promise<{ success: boolean; message?: string }> => {
  try {
    if (!apiKey) return { success: false, message: "Ingen nyckel laddad." };
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: 'Test' }] },
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message || "Okänt fel vid anslutning" };
  }
};

// --- TTS FUNCTIONS ---

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const playTextAsSpeech = async (text: string): Promise<void> => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  if (audioContext.state === 'suspended') await audioContext.resume();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: { parts: [{ text: text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' }, 
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
       const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        audioContext,
        24000,
        1
      );
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
    }
  } catch (error) {
    console.error("TTS Failed:", error);
  }
};


export const generateRewardImage = async (prompt: string): Promise<string | null> => {
  if (!prompt) return null;

  if (imageCache.has(prompt)) {
    const cached = imageCache.get(prompt);
    if (cached === 'BLOCKED') return null;
    return cached || null;
  }

  try {
    const dbImage = await trainDb.getImage(prompt);
    
    if (dbImage) {
      if (dbImage === 'BLOCKED') {
         imageCache.set(prompt, 'BLOCKED');
         return null;
      }
      imageCache.set(prompt, dbImage);
      return dbImage;
    }
  } catch (e) {
    console.warn("DB Image read failed", e);
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `Cute, cartoon style, child friendly illustration of: ${prompt}. White background, clear lines, colorful. High quality, detailed.` }]
      },
      config: { responseModalities: [Modality.IMAGE] },
    });
    
    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
         const base64String = `data:image/png;base64,${part.inlineData.data}`;
         imageCache.set(prompt, base64String);
         trainDb.saveImage(prompt, base64String).catch(e => console.warn("Failed to save image to DB", e));
         return base64String;
    }
    return null;
  } catch (error) {
    console.error("Failed to generate reward image:", error);
    return null;
  }
};

export const removeBadImage = async (prompt: string): Promise<void> => {
  imageCache.delete(prompt);
  imageCache.set(prompt, "BLOCKED"); 
  await trainDb.blockImage(prompt);
};

const fetchFromAIAndSave = async (
  subject: Subject, 
  difficulty: number, 
  useDigits: boolean, 
  currentCarCount: number, 
  specificFocus: string,
  bannedTopics: string[]
): Promise<Question> => {
  
  const levelContext = difficulty === 1 
    ? "NIVÅ: FÖRSKOLEKLASS (Mycket enkelt). Använd enkla begrepp." 
    : `NIVÅ: ${difficulty} (1=Enkelt, 5=Svårt).`;

  const numberFormattingRule = useDigits 
    ? "ANVÄND SIFFROR (1, 2, 3) ISTÄLLET FÖR BOKSTÄVER FÖR ALLA TAL."
    : "ANVÄND BOKSTÄVER (ETT, TVÅ, TRE) FÖR ENKLA TAL.";

  let promptContext = "";
  switch (subject) {
    case Subject.MATH:
      promptContext = `Matematik. FOKUS: ${specificFocus}. VIKTIGT: VARIERA TEMAT (Sport, Mat, Djur, Rymden).`;
      break;
    case Subject.LANGUAGE:
      promptContext = `Svenska språket. FOKUS: ${specificFocus}. VIKTIGT: VARIERA TEMAT.`;
      break;
    case Subject.LOGIC:
      promptContext = `Logik. FOKUS: ${specificFocus}. VIKTIGT: VARIERA TEMAT.`;
      break;
    case Subject.PHYSICS:
      promptContext = `Natur och Teknik. FOKUS: ${specificFocus}. VIKTIGT: VARIERA TEMAT.`;
      break;
  }

  let banInstruction = "";
  if (bannedTopics && bannedTopics.length > 0) {
      banInstruction = `- UNDVIK DESSA ÄMNEN HELT (De förekommer för ofta): ${bannedTopics.join(', ')}.`;
  }

  const prompt = `
    Du ska skapa en quiz-fråga för en 6-årig pojke.
    Instruktioner:
    1. Ämne: ${subject}.
    2. ${levelContext}
    3. FOKUS: ${specificFocus}.
    4. SPRÅK: Svenska, VERSALER.
    5. ${numberFormattingRule}
    6. REGLER FÖR VARIATION:
       ${banInstruction}
       - Fråga ALDRIG hur många vagnar tåget har.
       - Fråga ALDRIG frågor som "Hur många X ser du på bilden?".
       - Frågorna SKA kunna besvaras med bara texten/logiken. Bilden är bara dekoration.
    
    JSON format required.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema,
      temperature: 1.1, 
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");

  const data = JSON.parse(text);

  const newQuestion: Question = {
    id: crypto.randomUUID(),
    type: 'MULTIPLE_CHOICE',
    text: data.questionText.toUpperCase(),
    options: data.options.map((o: string) => o.toUpperCase()),
    correctAnswerIndex: data.correctAnswerIndex,
    explanation: data.explanation.toUpperCase(),
    difficultyLevel: difficulty,
    visualSubject: data.visualSubject
  };

  trainDb.saveQuestion(newQuestion, subject).catch(e => console.error("Save to DB failed", e));

  return newQuestion;
};

export const markQuestionTooHard = async (question: Question): Promise<void> => {
  const newDifficulty = Math.min(5, question.difficultyLevel + 1);
  await trainDb.updateQuestionDifficulty(question.id, newDifficulty);
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const batchGenerateQuestions = async (
  count: number, 
  useDigits: boolean, 
  difficulties: Record<Subject, number>,
  bannedTopics: string[],
  onProgress: (completed: number) => void,
  onError?: (errorMsg: string) => void,
  targetSubject?: Subject,      // NEW: Optional specific subject
  targetDifficulty?: number     // NEW: Optional specific difficulty override
): Promise<void> => {
  
  // If targets are provided, we only use them. Otherwise we cycle through all subjects
  const subjects = targetSubject ? [targetSubject] : [Subject.MATH, Subject.LANGUAGE, Subject.LOGIC, Subject.PHYSICS];
  
  for (let i = 0; i < count; i++) {
    try {
      if (i > 0) await delay(5000);

      const subject = subjects[i % subjects.length];
      const difficulty = targetDifficulty || difficulties[subject]; // Use override if present
      const subTopics = SUB_TOPICS[subject];
      const specificFocus = subTopics[Math.floor(Math.random() * subTopics.length)];
      
      await fetchFromAIAndSave(subject, difficulty, useDigits, 5, specificFocus, bannedTopics);
      onProgress(i + 1);
    } catch (error: any) {
      console.error("Batch generation error at index " + i, error);
      const msg = error.message || String(error);
      
      if (msg.includes('429') || msg.includes('quota')) {
         if (onError) onError(`Kvot överskriden (429). Vänta en stund. Detaljer: ${msg}`);
         break; 
      }
      if (onError) onError(`Fel vid fråga ${i+1}: ${msg.substring(0, 80)}...`);
    }
  }
};

export const batchGenerateImages = async (
  prompts: string[],
  onProgress: (completed: number) => void,
  onError?: (errorMsg: string) => void
): Promise<void> => {
  for (let i = 0; i < prompts.length; i++) {
      try {
          if (i > 0) await delay(5000);
          const prompt = prompts[i];
          await generateRewardImage(prompt);
          onProgress(i + 1);
      } catch (e: any) {
          if (onError) onError(e.message);
      }
  }
};

export const generateQuestion = async (
  subject: Subject, 
  difficulty: number, 
  useDigits: boolean, 
  currentCarCount: number, 
  previousType?: QuestionType,
  bannedTopics: string[] = [],
  allowDragDrop: boolean = true // New parameter to throttle drag/drop frequency
): Promise<Question> => {
  
  // Only generate drag/drop if allowed by the session manager
  const canTriggerDragDrop = subject === Subject.MATH && difficulty <= 2 && previousType !== 'DRAG_AND_DROP' && allowDragDrop;
  
  if (canTriggerDragDrop && Math.random() < 0.3) {
    return generateDragDropQuestion(difficulty);
  }

  try {
    // Check counts specific to this Difficulty Level
    const dbCount = await trainDb.getQuestionCount(subject, difficulty);
    
    let aiProbability = 0;
    // More aggressive AI generation to reach target of 200 questions PER LEVEL
    if (dbCount < 100) {
      aiProbability = 1.0; // Always gen new until 100 items
    } else if (dbCount < 200) {
      aiProbability = 0.4; // 40% chance of new until 200 items
    } else {
      aiProbability = 0.05; // Maintenance mode (5% chance of new)
    }

    const rollDice = Math.random(); 
    const forceAI = rollDice < aiProbability;

    if (!forceAI) {
      const dbQuestion = await trainDb.getRandomQuestion(subject, difficulty);
      if (dbQuestion) {
        return { ...dbQuestion, id: crypto.randomUUID() };
      }
    }

    const subTopics = SUB_TOPICS[subject];
    const specificFocus = subTopics[Math.floor(Math.random() * subTopics.length)];
    
    return await fetchFromAIAndSave(subject, difficulty, useDigits, currentCarCount, specificFocus, bannedTopics);

  } catch (error) {
    console.error("Error in generateQuestion:", error);
    
    try {
      const rescueQuestion = await trainDb.getRandomQuestion(subject); // Any difficulty backup
      if (rescueQuestion) {
        return { ...rescueQuestion, id: crypto.randomUUID() };
      }
    } catch (dbError) {
      console.warn("DB rescue failed", dbError);
    }

    const fallbackBase = FALLBACK_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUESTIONS.length)];
    return {
      ...fallbackBase,
      id: crypto.randomUUID(),
      difficultyLevel: difficulty
    };
  }
};

// --- AI DEDUPLICATION ---

export const checkDuplicatesWithAI = async (questions: {id: string, text: string}[], context: string): Promise<string[]> => {
  if (questions.length < 2) return [];

  const duplicateSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      idsToDelete: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of IDs belonging to questions that are redundant/duplicates."
      }
    }
  };

  const prompt = `
    Du är en expert på att städa databaser för barn-appar.
    Här är en lista med frågor inom: ${context}.
    Hitta dubbletter.
    
    REGLER:
    1. SEMANTISK LIKHET: Om två frågor frågar om samma faktakunskap, ta bort den ena.
    2. MATEMATIK: Om siffrorna skiljer sig åt är det INTE en dublett. (1+1 vs 2+2 = OK).
    3. STAVFEL: Ta bort felstavade varianter.

    Returnera IDs att radera.
    INPUT JSON:
    ${JSON.stringify(questions)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: duplicateSchema,
        temperature: 0, 
      },
    });
    
    if (response.text) {
        const result = JSON.parse(response.text);
        return result.idsToDelete || [];
    }
    return [];
  } catch (e) {
    console.error("AI Deduplication failed", e);
    return [];
  }
};
