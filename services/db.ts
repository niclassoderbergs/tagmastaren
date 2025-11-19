import { Question, Subject } from '../types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DB_NAME = 'TrainMasterDB';
const DB_VERSION = 1;
const STORE_QUESTIONS = 'questions';
const STORE_IMAGES = 'images';

interface ImageRecord {
  prompt: string;
  base64: string;
  timestamp: number;
}

interface BackupData {
  questions: (Question & { subject: Subject })[];
  images: ImageRecord[];
  timestamp: number;
  version: number;
}

export interface DbStats {
  mathCount: number;
  languageCount: number;
  logicCount: number;
  physicsCount: number;
  imageCount: number;
}

class TrainDB {
  private db: IDBDatabase | null = null;
  private supabase: SupabaseClient | null = null;

  // Initialize Cloud Connection
  initCloud(url: string, key: string) {
    if (url && key) {
      try {
        this.supabase = createClient(url, key);
        console.log("Cloud connection initialized");
      } catch (e) {
        console.error("Invalid Cloud Config", e);
      }
    }
  }

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject("Error opening database");

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Store for Questions
        if (!db.objectStoreNames.contains(STORE_QUESTIONS)) {
          const qStore = db.createObjectStore(STORE_QUESTIONS, { keyPath: 'id' });
          qStore.createIndex('subject', 'subject', { unique: false });
        }

        // Store for Images (Key is the prompt/visualSubject)
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: 'prompt' });
        }
      };
    });
  }

  async saveQuestion(question: Question, subject: Subject): Promise<void> {
    const db = await this.open();
    const record = { ...question, subject }; 

    // 1. Save Locally
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject("Failed to save question locally");
    });

    // 2. Save to Cloud (Fire and forget to not block UI)
    if (this.supabase) {
      this.supabase.from('questions').upsert({
        id: question.id,
        type: question.type,
        text: question.text,
        options: question.options,
        correct_answer_index: question.correctAnswerIndex,
        explanation: question.explanation,
        difficulty_level: question.difficultyLevel,
        visual_subject: question.visualSubject,
        subject: subject
      }).then(({ error }) => {
        if (error) console.error("Cloud save error:", error);
      });
    }
  }

  async updateQuestionDifficulty(id: string, newDifficulty: number): Promise<void> {
    const db = await this.open();
    
    // 1. Update Local
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          record.difficultyLevel = newDifficulty;
          const updateRequest = store.put(record);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject("Failed to update question difficulty");
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject("Failed to find question");
    });

    // 2. Update Cloud
    if (this.supabase) {
      this.supabase.from('questions').update({ difficulty_level: newDifficulty }).eq('id', id)
        .then(({ error }) => { if(error) console.error("Cloud update error", error)});
    }
  }

  async getQuestionCount(subject: Subject): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const index = store.index('subject');
      const request = index.count(subject);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  }

  async getDatabaseStats(): Promise<DbStats> {
    const db = await this.open();
    
    const countSubject = (subject: Subject): Promise<number> => {
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
        const store = transaction.objectStore(STORE_QUESTIONS);
        const index = store.index('subject');
        const request = index.count(subject);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    };

    const countImages = (): Promise<number> => {
       return new Promise((resolve) => {
        const transaction = db.transaction([STORE_IMAGES], 'readonly');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      });
    };

    const [math, lang, logic, phys, imgs] = await Promise.all([
      countSubject(Subject.MATH),
      countSubject(Subject.LANGUAGE),
      countSubject(Subject.LOGIC),
      countSubject(Subject.PHYSICS),
      countImages()
    ]);

    return {
      mathCount: math,
      languageCount: lang,
      logicCount: logic,
      physicsCount: phys,
      imageCount: imgs
    };
  }

  async getRandomQuestion(subject: Subject): Promise<Question | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const index = store.index('subject');
      
      const keyRequest = index.getAllKeys(subject);

      keyRequest.onsuccess = () => {
        const keys = keyRequest.result;
        if (keys.length === 0) {
          resolve(null);
          return;
        }
        
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        const objRequest = store.get(randomKey);
        objRequest.onsuccess = () => resolve(objRequest.result as Question);
        objRequest.onerror = () => resolve(null);
      };
      
      keyRequest.onerror = () => reject("Failed to get keys");
    });
  }

  async saveImage(prompt: string, base64: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const record: ImageRecord = { prompt, base64, timestamp: Date.now() };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject("Failed to save image");
    });
  }

  async blockImage(prompt: string): Promise<void> {
    return this.saveImage(prompt, "BLOCKED");
  }

  async getImage(prompt: string): Promise<string | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_IMAGES], 'readonly');
      const store = transaction.objectStore(STORE_IMAGES);
      const request = store.get(prompt);

      request.onsuccess = () => {
        const result = request.result as ImageRecord;
        resolve(result ? result.base64 : null);
      };
      request.onerror = () => resolve(null);
    });
  }

  // --- CLOUD SYNC (New) ---
  
  async syncLocalToCloud(): Promise<number> {
    if (!this.supabase) throw new Error("Molnet ej konfigurerat");

    // Get all local questions
    const db = await this.open();
    const questions: any[] = await new Promise((resolve) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    let syncedCount = 0;
    // Upload in batches or loop (simple loop for now as users wont have millions of rows)
    for (const q of questions) {
      const { error } = await this.supabase.from('questions').upsert({
        id: q.id,
        type: q.type,
        text: q.text,
        options: q.options,
        correct_answer_index: q.correctAnswerIndex,
        explanation: q.explanation,
        difficulty_level: q.difficultyLevel,
        visual_subject: q.visualSubject,
        subject: q.subject
      }, { onConflict: 'id' });
      
      if (!error) syncedCount++;
    }
    return syncedCount;
  }

  async syncCloudToLocal(): Promise<number> {
    if (!this.supabase) throw new Error("Molnet ej konfigurerat");

    const { data, error } = await this.supabase.from('questions').select('*');
    if (error || !data) throw error || new Error("Ingen data");

    const db = await this.open();
    const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);

    let count = 0;
    for (const row of data) {
      // Convert snake_case back to camelCase object
      const question: Question & { subject: string } = {
        id: row.id,
        type: row.type as any,
        text: row.text,
        options: row.options,
        correctAnswerIndex: row.correct_answer_index,
        explanation: row.explanation,
        difficultyLevel: row.difficulty_level,
        visualSubject: row.visual_subject,
        subject: row.subject
      };
      store.put(question);
      count++;
    }
    return count;
  }

  // --- EXPORT/IMPORT ---

  async exportDatabase(): Promise<string> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS, STORE_IMAGES], 'readonly');
      
      const qStore = transaction.objectStore(STORE_QUESTIONS);
      const iStore = transaction.objectStore(STORE_IMAGES);

      const questionsRequest = qStore.getAll();
      const imagesRequest = iStore.getAll();

      let questions: any[] = [];
      let images: any[] = [];
      let completed = 0;

      const checkDone = () => {
        completed++;
        if (completed === 2) {
          const backup: BackupData = {
            questions: questions,
            images: images,
            timestamp: Date.now(),
            version: 1
          };
          resolve(JSON.stringify(backup));
        }
      };

      questionsRequest.onsuccess = () => {
        questions = questionsRequest.result;
        checkDone();
      };

      imagesRequest.onsuccess = () => {
        images = imagesRequest.result;
        checkDone();
      };

      transaction.onerror = () => reject("Export failed");
    });
  }

  async importDatabase(jsonString: string): Promise<number> {
    const db = await this.open();
    let data: BackupData;
    
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("Invalid JSON file");
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_QUESTIONS, STORE_IMAGES], 'readwrite');
      
      const qStore = transaction.objectStore(STORE_QUESTIONS);
      const iStore = transaction.objectStore(STORE_IMAGES);

      let count = 0;
      if (data.questions) {
        data.questions.forEach(q => {
          qStore.put(q);
          count++;
        });
      }
      if (data.images) {
        data.images.forEach(img => {
          iStore.put(img);
        });
      }
      transaction.oncomplete = () => resolve(count);
      transaction.onerror = () => reject("Import failed");
    });
  }
}

export const trainDb = new TrainDB();