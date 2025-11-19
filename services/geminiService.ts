import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Subject, Question, QuestionType } from "../types";
import { trainDb } from "./db";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// In-memory fallback only used for very first load if DB is empty and API fails
const imageCache = new Map<string, string>(); // Keep a small RAM cache for immediate reuse in session

// --- AUDIO CONTEXT FOR TTS ---
let audioContext: AudioContext | null = null;

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
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VAD RIMMAR PÅ 'HUS'?",
    options: ["BIL", "MUS", "KATT", "TÅG"],
    correctAnswerIndex: 1,
    explanation: "HUS OCH MUS SLUTAR PÅ SAMMA LJUD.",
    difficultyLevel: 1,
    visualSubject: "A cute mouse"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VILKEN FORM HAR 3 HÖRN?",
    options: ["CIRKEL", "KVADRAT", "TRIANGEL", "REKTANGEL"],
    correctAnswerIndex: 2,
    explanation: "TRIANGELN HAR TRE SIDOR OCH TRE HÖRN.",
    difficultyLevel: 2,
    visualSubject: "A green triangle shape"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "MOTSATSEN TILL 'VARM' ÄR...?",
    options: ["STARK", "GLAD", "KALL", "MJUK"],
    correctAnswerIndex: 2,
    explanation: "OM MAN INTE ÄR VARM SÅ ÄR MAN KALL.",
    difficultyLevel: 1,
    visualSubject: "Ice cubes and snow"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VAD BEHÖVER VÄXTER FÖR ATT LEVA?",
    options: ["GODIS", "VATTEN", "BENSIN", "MJÖLK"],
    correctAnswerIndex: 1,
    explanation: "VÄXTER DRICKER VATTEN OCH BEHÖVER SOLLJUS.",
    difficultyLevel: 2,
    visualSubject: "A watering can watering a flower"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VILKET TAL ÄR STÖRST?",
    options: ["2", "5", "9", "1"],
    correctAnswerIndex: 2,
    explanation: "9 ÄR DET HÖGSTA TALET I LISTAN.",
    difficultyLevel: 1,
    visualSubject: undefined
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VAD ANVÄNDER TÅGET FÖR ATT RULLA?",
    options: ["FÖTTER", "HJUL", "VINGAR", "FENOR"],
    correctAnswerIndex: 1,
    explanation: "TÅGET HAR HJUL AV METALL SOM RULLAR PÅ RÄLSEN.",
    difficultyLevel: 1,
    visualSubject: "Train wheels close up"
  },
  {
    type: 'MULTIPLE_CHOICE',
    text: "VILKEN FÄRG FÅR DU OM DU BLANDAR RÖD OCH GUL?",
    options: ["BLÅ", "GRÖN", "ORANGE", "LILA"],
    correctAnswerIndex: 2,
    explanation: "RÖD OCH GUL TILLSAMMANS BLIR ORANGE.",
    difficultyLevel: 2,
    visualSubject: "Orange paint bucket"
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

const SUB_TOPICS: Record<Subject, string[]> = {
  [Subject.MATH]: [
    "RÄKNA ANTAL (Hur många...)",
    "ENKEL ADDITION (Plus)",
    "ENKEL SUBTRAKTION (Minus)",
    "KLOCKAN OCH TID (Hel och halvtimme)",
    "PENGAR OCH HANDLA",
    "GEOMETRISKA FORMER",
    "MÖNSTER I TALSERIER (Vad kommer sen? 2, 4, 6...)",
    "DUBBELT OCH HÄLFTEN",
    "STORLEKSORDNING (Minst till störst)"
  ],
  [Subject.LANGUAGE]: [
    "RIM OCH RAMSOR (Perfekta rim)",
    "MOTSATSORD (Stor/Liten, Varm/Kall)",
    "SYNONYMER (Ord som betyder samma sak)",
    "SAMMANSATTA ORD (T.ex Sol + Glasögon)",
    "VILKEN BOKSTAV BÖRJAR ORDET PÅ?",
    "STAVNING (Vilket ord är rättstavat?)",
    "LISTA UT ORDET (Jag har fyra ben och skäller...)",
    "ORDKUNSKAP (Vad är en...)"
  ],
  [Subject.LOGIC]: [
    "VAD SKA BORT? (Vilken sak hör inte hit?)",
    "FORMMÖNSTER (Vad kommer härnäst?)",
    "ORSAK OCH VERKAN (Vad händer om...?)",
    "SORTERING (Vilka saker hör ihop?)",
    "SPATIAL FÖRMÅGA (Vrida och vända på former mentalt)",
    "GÅTOR OCH KLURINGAR"
  ],
  [Subject.PHYSICS]: [
    "RYMDEN (Planeter, stjärnor, månen)",
    "DJUR (Vad äter de? Var bor de? Däggdjur/Fåglar)",
    "KROPPEN (Hjärtat, tänder, sinnen, skelett)",
    "VATTEN OCH LUFT (Flyta/sjunka, is/ånga)",
    "TEKNIK I VARDAGEN (Verktyg, enkla maskiner, hjulet)",
    "MATERIAL (Hårt, mjukt, magnetiskt, trä/metall)",
    "VÄDER OCH ÅRSTIDER",
    "DINOSAURIER OCH FORNTID",
    "VÄXTER OCH TRÄD"
  ]
};

const generateDragDropQuestion = (difficulty: number): Question => {
  const items = [
    { emoji: '🐮', name: 'KOSSOR', container: 'BOSKAPSVAGNEN' },
    { emoji: '📦', name: 'LÅDOR', container: 'GODSVAGNEN' },
    { emoji: '🪵', name: 'TIMMERSTOCKAR', container: 'TIMMERVAGNEN' },
    { emoji: '🧳', name: 'RESVÄSKOR', container: 'PASSAGERARVAGNEN' },
    { emoji: '⚙️', name: 'KUGGHJUL', container: 'VERKSTADSVAGNEN' }
  ];

  const selectedItem = items[Math.floor(Math.random() * items.length)];
  const targetCount = difficulty === 1 
    ? Math.floor(Math.random() * 5) + 1 
    : Math.floor(Math.random() * 7) + 4;
  
  const totalItems = targetCount + Math.floor(Math.random() * 4) + 2; 

  return {
    id: crypto.randomUUID(),
    type: 'DRAG_AND_DROP',
    text: `LASTKAJEN: LASTA PÅ EXAKT ${targetCount} ST ${selectedItem.name} PÅ ${selectedItem.container}.`,
    explanation: `BRA JOBBAT! NU HAR TÅGET ${targetCount} ${selectedItem.name} MED SIG.`,
    difficultyLevel: difficulty,
    dragDropConfig: {
      itemEmoji: selectedItem.emoji,
      targetCount: targetCount,
      totalItems: totalItems,
      containerName: selectedItem.container
    }
  };
};

export const testApiKey = async (): Promise<{ success: boolean; message?: string }> => {
  try {
    // Minimal request to check auth and project validity
    if (!process.env.API_KEY) {
      return { success: false, message: "API Key is missing (process.env.API_KEY is empty)" };
    }

    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: 'Test' }] },
    });
    return { success: true };
  } catch (error: any) {
    console.warn("API Key Test Failed:", error);
    return { success: false, message: error.message || "Unknown API error" };
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

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: { parts: [{ text: text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' }, // Puck has a friendly, slightly higher pitch suitable for kids apps
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

  // 1. Check In-Memory Cache
  if (imageCache.has(prompt)) {
    const cached = imageCache.get(prompt);
    if (cached === 'BLOCKED') return null;
    return cached || null;
  }

  // 2. Check Persistent DB
  try {
    const dbImage = await trainDb.getImage(prompt);
    
    if (dbImage) {
      // If explicitly blocked, respect it and return null
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

  // 3. Generate from AI
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
             text: `Cute, cartoon style, child friendly illustration of: ${prompt}. White background, clear lines, colorful. High quality, detailed.`
          }
        ]
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });
    
    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part && part.inlineData && part.inlineData.data) {
         const base64String = `data:image/png;base64,${part.inlineData.data}`;
         
         // Save to both caches
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
  // Update memory cache
  imageCache.delete(prompt);
  imageCache.set(prompt, "BLOCKED"); 
  // Update persistent DB to block future generation
  await trainDb.blockImage(prompt);
};

const fetchFromAIAndSave = async (
  subject: Subject, 
  difficulty: number, 
  useDigits: boolean, 
  currentCarCount: number, 
  specificFocus: string
): Promise<Question> => {
  
  const levelContext = difficulty === 1 
    ? "NIVÅ: FÖRSKOLEKLASS (Mycket enkelt). Använd enkla begrepp." 
    : `NIVÅ: ${difficulty} (1=Enkelt, 5=Svårt).`;

  const numberFormattingRule = useDigits 
    ? "ANVÄND SIFFROR (1, 2, 3) ISTÄLLET FÖR BOKSTÄVER FÖR ALLA TAL. (Skriv inte 'TVÅ', skriv '2')."
    : "ANVÄND BOKSTÄVER (ETT, TVÅ, TRE) FÖR ENKLA TAL OM DET PASSAR SPRÅKLIGT.";

  let promptContext = "";
  switch (subject) {
    case Subject.MATH:
      promptContext = `Matematik. FOKUSERA PÅ: ${specificFocus}. Använd tågtema om det passar. Användaren har ${currentCarCount} vagnar.`;
      break;
    case Subject.LANGUAGE:
      promptContext = `Svenska språket. FOKUSERA PÅ: ${specificFocus}.`;
      break;
    case Subject.LOGIC:
      promptContext = `Logik. FOKUSERA PÅ: ${specificFocus}.`;
      break;
    case Subject.PHYSICS:
      promptContext = `Natur och Teknik. FOKUSERA PÅ: ${specificFocus}.`;
      break;
  }

  const prompt = `
    Du ska skapa en quiz-fråga för en 6-årig pojke.
    Instruktioner:
    1. Ämne: ${subject}.
    2. ${levelContext}
    3. FOKUS: ${specificFocus}.
    4. SPRÅK: Svenska, VERSALER.
    5. ${numberFormattingRule}
    
    JSON format required.
    VisualSubject: English description for an image if concrete object, else null.
    Context: ${promptContext}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: questionSchema,
      temperature: 0.8,
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

  // Save to DB for future use
  trainDb.saveQuestion(newQuestion, subject).catch(e => console.error("Save to DB failed", e));

  return newQuestion;
};

export const markQuestionTooHard = async (question: Question): Promise<void> => {
  const newDifficulty = Math.min(5, question.difficultyLevel + 1);
  await trainDb.updateQuestionDifficulty(question.id, newDifficulty);
};

export const batchGenerateQuestions = async (
  count: number, 
  useDigits: boolean, 
  difficulties: Record<Subject, number>,
  onProgress: (completed: number) => void
): Promise<void> => {
  const subjects = [Subject.MATH, Subject.LANGUAGE, Subject.LOGIC, Subject.PHYSICS];
  
  for (let i = 0; i < count; i++) {
    try {
      // Rotate through subjects
      const subject = subjects[i % subjects.length];
      const difficulty = difficulties[subject];
      const subTopics = SUB_TOPICS[subject];
      const specificFocus = subTopics[Math.floor(Math.random() * subTopics.length)];
      
      // We generate but don't need the return value, it saves to DB internally
      await fetchFromAIAndSave(subject, difficulty, useDigits, 5, specificFocus);
      
      onProgress(i + 1);
    } catch (error) {
      console.error("Batch generation error at index " + i, error);
      // Continue despite error to try and finish batch
    }
  }
};

export const generateQuestion = async (
  subject: Subject, 
  difficulty: number, 
  useDigits: boolean, 
  currentCarCount: number,
  previousType?: QuestionType
): Promise<Question> => {
  
  // 1. Drag Drop Logic (unchanged)
  const canTriggerDragDrop = subject === Subject.MATH && difficulty <= 2 && previousType !== 'DRAG_AND_DROP';
  if (canTriggerDragDrop && Math.random() < 0.3) {
    return generateDragDropQuestion(difficulty);
  }

  // 2. STRATEGY SELECTION (DB vs AI)
  try {
    const dbCount = await trainDb.getQuestionCount(subject);
    
    // Dynamic Probability Strategy based on DB size
    // < 50:   100% New (Build phase)
    // 50-99:  20% New (1 in 5)
    // 100-199: 10% New (1 in 10)
    // >= 200:  5% New (1 in 20)
    
    let aiProbability = 0;
    if (dbCount < 50) {
      aiProbability = 1.0; 
    } else if (dbCount < 100) {
      aiProbability = 0.2;
    } else if (dbCount < 200) {
      aiProbability = 0.1;
    } else {
      aiProbability = 0.05;
    }

    const rollDice = Math.random(); // 0.0 to 1.0
    const forceAI = rollDice < aiProbability;

    // Try fetching from DB if we are NOT forced to use AI
    if (!forceAI) {
      const dbQuestion = await trainDb.getRandomQuestion(subject);
      if (dbQuestion) {
        // Important: We generate a new UUID even for cached questions so React keys update
        return { ...dbQuestion, id: crypto.randomUUID() };
      }
    }

    // 3. AI GENERATION
    const subTopics = SUB_TOPICS[subject];
    const specificFocus = subTopics[Math.floor(Math.random() * subTopics.length)];
    
    return await fetchFromAIAndSave(subject, difficulty, useDigits, currentCarCount, specificFocus);

  } catch (error) {
    console.error("Error in generateQuestion:", error);
    
    // 4. ROBUST FALLBACK
    // If AI failed (e.g. 429 Quota), TRY DB AGAIN even if we wanted AI.
    try {
      const rescueQuestion = await trainDb.getRandomQuestion(subject);
      if (rescueQuestion) {
        console.log("AI failed, rescued by DB cache.");
        return { ...rescueQuestion, id: crypto.randomUUID() };
      }
    } catch (dbError) {
      console.warn("DB rescue failed", dbError);
    }

    // 5. ULTIMATE FALLBACK (Hardcoded)
    const fallbackBase = FALLBACK_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUESTIONS.length)];
    return {
      ...fallbackBase,
      id: crypto.randomUUID(),
      difficultyLevel: difficulty
    };
  }
};