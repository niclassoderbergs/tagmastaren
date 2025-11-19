
export enum Subject {
  MATH = 'MATH',
  LANGUAGE = 'LANGUAGE',
  LOGIC = 'LOGIC',
  PHYSICS = 'PHYSICS'
}

export type QuestionType = 'MULTIPLE_CHOICE' | 'DRAG_AND_DROP';

export interface DragDropConfig {
  itemEmoji: string;
  targetCount: number;
  totalItems: number;
  containerName: string; // e.g., "Boskapsvagnen" or "Bordet"
  sourceName?: string; // e.g., "Lastkajen" or "Köksluckan"
  verb?: string; // e.g., "Lasta på" or "Duka fram"
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options?: string[]; // Optional for Drag/Drop
  correctAnswerIndex?: number; // Optional for Drag/Drop
  dragDropConfig?: DragDropConfig;
  explanation: string;
  difficultyLevel: number; // 1-5
  visualSubject?: string; // Description for image generation (e.g., "A T-Rex dinosaur")
  preloadedImageUrl?: string; // Holds the URL if image was generated in background
}

export interface TrainCar {
  id: string;
  type: 'LOCOMOTIVE' | 'COAL' | 'PASSENGER' | 'CARGO' | 'TANKER' | 'CABOOSE';
  color: string;
}

export interface GameState {
  score: number;
  cars: TrainCar[];
  currentStreak: number;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface AppSettings {
  useUppercase: boolean;
  useDigits: boolean; // New setting for number formatting
  subjectDifficulty: Record<Subject, number>;
  firebaseConfig?: FirebaseConfig; // For cloud sync
  enableBannedTopics: boolean; // Toggle for the ban list
  bannedTopics: string[]; // List of topics to exclude from AI generation
}
