
import { Question, Subject, FirebaseConfig } from '../types';
import { initializeApp, FirebaseApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore, doc, setDoc, getDocs, collection, writeBatch, getCountFromServer } from 'firebase/firestore';

const DB_NAME = 'TrainMasterDB';
const DB_VERSION = 1;
const STORE_QUESTIONS = 'questions';
const STORE_IMAGES = 'images';

// SECURITY WARNING: Never hardcode API keys here. 
// Use environment variables (VITE_FIREBASE_...) in a .env.local file.
const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

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
  private firebaseApp: FirebaseApp | null = null;
  private firestore: Firestore | null = null;

  constructor() {
    // 1. Try Environment Variables via import.meta.env (Standard Vite approach)
    // @ts-ignore
    const env = (import.meta.env as any) || {};
    
    const apiKey = env.VITE_FIREBASE_API_KEY;
    const projectId = env.VITE_FIREBASE_PROJECT_ID;
    
    if (apiKey && projectId) {
      const config: FirebaseConfig = {
        apiKey: apiKey,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
        projectId: projectId,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
        appId: env.VITE_FIREBASE_APP_ID || ""
      };
      this.initCloud(config);
      console.log("✅ Firebase config loaded from environment");
    } else {
      // 2. Fallback to empty config. 
      console.warn("⚠️ No Firebase config found in environment variables (checking VITE_FIREBASE_...). Cloud sync disabled.");
      this.initCloud(DEFAULT_FIREBASE_CONFIG);
    }
  }

  // Initialize Cloud Connection
  initCloud(config: FirebaseConfig) {
    if (config && config.apiKey && config.projectId) {
      try {
        // Prevent "Firebase App already exists" error in HMR/dev
        if (getApps().length === 0) {
            this.firebaseApp = initializeApp(config);
        } else {
            this.firebaseApp = getApp();
        }
        
        this.firestore = getFirestore(this.firebaseApp);
        console.log(`Firebase Cloud connection initialized (${config.projectId})`);
      } catch (e) {
        console.error("Invalid Cloud Config", e);
      }
    }
  }
  
  isCloudConnected(): boolean {
    return !!this.firestore;
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

    // 2. Save to Cloud (Fire and forget)
    if (this.firestore) {
      // Use setDoc with merge to be safe
      setDoc(doc(this.firestore, 'questions', question.id), {
        ...question,
        subject,
        createdAt: new Date().toISOString()
      }, { merge: true }).catch(e => console.error("Cloud save error:", e));
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
    if (this.firestore) {
      setDoc(doc(this.firestore, 'questions', id), { difficultyLevel: newDifficulty }, { merge: true })
        .catch(e => console.error("Cloud update error", e));
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

  // --- CLOUD SYNC (FIREBASE) ---

  /**
   * Checks how many questions are currently stored in the cloud.
   * Returns -1 if not connected or error.
   */
  async getCloudQuestionCount(): Promise<number> {
    if (!this.firestore) return -1;
    try {
      // Efficient server-side counting
      const coll = collection(this.firestore, 'questions');
      const snapshot = await getCountFromServer(coll);
      return snapshot.data().count;
    } catch (e) {
      console.error("Failed to check cloud count", e);
      return -1;
    }
  }

  /**
   * Sends a dummy document to Firestore to verify connection and permissions.
   */
  async sendTestData(): Promise<void> {
    if (!this.firestore) throw new Error("Molnet ej konfigurerat");
    
    const testDocRef = doc(this.firestore, '_connection_test', 'ping');
    await setDoc(testDocRef, {
      message: "Connection Successful",
      timestamp: new Date().toISOString(),
      platform: navigator.userAgent
    });
  }
  
  async syncLocalToCloud(): Promise<number> {
    if (!this.firestore) throw new Error("Molnet ej konfigurerat (Firebase)");

    // Get all local questions
    const db = await this.open();
    const questions: any[] = await new Promise((resolve) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    if (questions.length === 0) return 0;

    // Firebase Batch Write (Max 500 per batch)
    let syncedCount = 0;
    const BATCH_SIZE = 400; 
    
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = writeBatch(this.firestore);
      const chunk = questions.slice(i, i + BATCH_SIZE);
      
      chunk.forEach(q => {
        const docRef = doc(this.firestore!, 'questions', q.id);
        // Ensure we don't have undefined values, convert to plain object
        const safeData = JSON.parse(JSON.stringify(q));
        batch.set(docRef, safeData, { merge: true });
      });

      await batch.commit();
      syncedCount += chunk.length;
    }

    return syncedCount;
  }

  async syncCloudToLocal(): Promise<number> {
    if (!this.firestore) throw new Error("Molnet ej konfigurerat (Firebase)");

    const querySnapshot = await getDocs(collection(this.firestore, 'questions'));
    
    if (querySnapshot.empty) return 0;

    const db = await this.open();
    const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);

    let count = 0;
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // Ensure correct type mapping if needed, Firestore returns standard JSON
      store.put(data);
      count++;
    });
    
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
