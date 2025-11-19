
import { Question, Subject, FirebaseConfig } from '../types';
import { initializeApp, FirebaseApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore, doc, setDoc, getDocs, collection, writeBatch, getCountFromServer, deleteDoc } from 'firebase/firestore';

const DB_NAME = 'TrainMasterDB';
const DB_VERSION = 1;
const STORE_QUESTIONS = 'questions';
const STORE_IMAGES = 'images';
const MAX_STORED_IMAGES = 50; // Keep last 50 images LOCALLY to save RAM/Storage

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

export interface CloudStats {
  questions: number;
  images: number;
}

export interface StorageEstimate {
  usage: number; // bytes
  quota: number; // bytes
  percent: number;
}

// --- HELPER FUNCTIONS FOR SMART DEDUPLICATION ---

// Levenshtein distance to calculate text similarity (0 to 100%)
const getSimilarity = (s1: string, s2: string): number => {
  let longer = s1;
  let shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  const longerLength = longer.length;
  if (longerLength === 0) {
    return 1.0;
  }
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength.toString());
};

const editDistance = (s1: string, s2: string): number => {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = new Array();
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i == 0)
        costs[j] = j;
      else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) != s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0)
      costs[s2.length] = lastValue;
  }
  return costs[s2.length];
};

// Extract numbers from string to protect Math questions
// Returns string like "1,5" for "What is 1 + 5?"
const extractNumbersFingerprint = (text: string): string => {
  const nums = text.match(/\d+/g);
  if (!nums) return "";
  return nums.sort().join(',');
};

// Helper to compress large images before cloud upload (Firestore 1MB limit)
const compressBase64 = (base64: string): Promise<string> => {
  return new Promise((resolve) => {
    // Basic check: if it's not an image data URL, return as is
    if (!base64.startsWith('data:image')) {
        resolve(base64);
        return;
    }

    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_DIM = 1024; // Limit max dimension to ensure < 1MB
      let width = img.width;
      let height = img.height;
      
      // Keep aspect ratio but limit size
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Convert to JPEG with 0.7 quality (usually < 200KB)
          resolve(canvas.toDataURL('image/jpeg', 0.7)); 
      } else {
          resolve(base64); // Fallback
      }
    };
    img.onerror = () => resolve(base64); // Fallback
  });
};

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
          const iStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'prompt' });
          iStore.createIndex('timestamp', 'timestamp', { unique: false });
        } else {
           // Migration for existing DBs if they lack index (simple fallback)
           // In a prod app we would handle versioning carefully
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
    
    // ALWAYS optimize/compress before saving anywhere
    // This converts PNG to JPEG (quality 0.7) which is much smaller and efficient
    let optimizedBase64 = base64;
    try {
        optimizedBase64 = await compressBase64(base64);
    } catch (e) {
        console.warn("Image optimization failed, falling back to original", e);
    }

    // 1. Prune old images if LOCAL limit reached (keeps browser fast)
    await this.pruneImages(db);

    // 2. Save to Cloud (Archive) - Using the optimized version
    if (this.firestore) {
        const safeId = encodeURIComponent(prompt); 
        
        // Safety check for the 1MB limit (should rarely hit with JPEG)
        if (optimizedBase64.length <= 1040000) {
            setDoc(doc(this.firestore, 'images', safeId), {
                prompt: prompt,
                base64: optimizedBase64,
                timestamp: Date.now()
            }, { merge: true }).catch(e => console.warn("Failed to save image to cloud", e));
        } else {
            console.warn("Image too big for cloud even after optimization.");
        }
    }

    // 3. Save Locally (Now using the optimized version to save user disk space)
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      const record: ImageRecord = { prompt, base64: optimizedBase64, timestamp: Date.now() };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject("Failed to save image locally");
    });
  }

  private async pruneImages(db: IDBDatabase): Promise<void> {
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_IMAGES], 'readwrite');
      const store = transaction.objectStore(STORE_IMAGES);
      
      // Check count
      const countReq = store.count();
      
      countReq.onsuccess = () => {
        if (countReq.result >= MAX_STORED_IMAGES) {
          // Strategy: Get all, sort in JS, delete oldest LOCALLY.
          const allReq = store.getAll();
          allReq.onsuccess = () => {
             const allImgs = allReq.result as ImageRecord[];
             if (allImgs.length >= MAX_STORED_IMAGES) {
                // Sort by timestamp ascending (oldest first)
                allImgs.sort((a, b) => a.timestamp - b.timestamp);
                
                // Calculate how many to remove
                const targetDelete = countReq.result - MAX_STORED_IMAGES + 1;
                const toRemove = allImgs.slice(0, targetDelete);
                
                toRemove.forEach(img => {
                   store.delete(img.prompt);
                });
             }
             resolve();
          };
        } else {
          resolve();
        }
      };
      
      countReq.onerror = () => resolve(); // Fail safe
    });
  }

  async blockImage(prompt: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_IMAGES], 'readwrite');
        const store = transaction.objectStore(STORE_IMAGES);
        const record: ImageRecord = { prompt, base64: "BLOCKED", timestamp: Date.now() };
        store.put(record).onsuccess = () => resolve();
        store.put(record).onerror = () => reject("Failed to block");
    });
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
  
  /**
   * Finds visualSubjects from questions that do NOT have a corresponding image in the local DB.
   */
  async getMissingVisualSubjects(): Promise<string[]> {
      const db = await this.open();
      return new Promise((resolve, reject) => {
         // Get all questions
         const qStore = db.transaction([STORE_QUESTIONS], 'readonly').objectStore(STORE_QUESTIONS);
         const qReq = qStore.getAll();
         
         qReq.onsuccess = () => {
             const questions = qReq.result as Question[];
             // Filter those that actually need an image
             const candidates = questions
                .filter(q => q.visualSubject && q.visualSubject.length > 0)
                .map(q => q.visualSubject!);
             
             const uniqueCandidates = [...new Set(candidates)];

             // Get all existing image prompts (keys)
             const iStore = db.transaction([STORE_IMAGES], 'readonly').objectStore(STORE_IMAGES);
             const iReq = iStore.getAllKeys();
             
             iReq.onsuccess = () => {
                 const existingPrompts = new Set(iReq.result as string[]);
                 const missing = uniqueCandidates.filter(s => !existingPrompts.has(s));
                 resolve(missing);
             };
             iReq.onerror = () => reject("Failed to read images");
         };
         qReq.onerror = () => reject("Failed to read questions");
      });
  }

  async getStorageEstimate(): Promise<StorageEstimate> {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 1024 * 1024 * 1024; // Default 1GB if unknown
        return {
          usage,
          quota,
          percent: Math.round((usage / quota) * 100)
        };
      } catch (e) {
        console.warn("Storage estimate failed", e);
      }
    }
    return { usage: 0, quota: 0, percent: 0 };
  }

  // --- CLOUD SYNC (FIREBASE) ---

  /**
   * Checks how many questions AND images are currently stored in the cloud.
   */
  async getCloudStats(): Promise<CloudStats> {
    if (!this.firestore) return { questions: -1, images: -1 };
    try {
      // Efficient server-side counting
      const qColl = collection(this.firestore, 'questions');
      const qSnapshot = await getCountFromServer(qColl);
      
      const iColl = collection(this.firestore, 'images');
      const iSnapshot = await getCountFromServer(iColl);

      return { 
          questions: qSnapshot.data().count,
          images: iSnapshot.data().count
      };
    } catch (e) {
      console.error("Failed to check cloud count", e);
      return { questions: -1, images: -1 };
    }
  }

  /**
   * Deprecated: Use getCloudStats instead for full picture
   */
  async getCloudQuestionCount(): Promise<number> {
     const stats = await this.getCloudStats();
     return stats.questions;
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

    // 1. Get all local questions AND images
    const db = await this.open();
    
    const questions: any[] = await new Promise((resolve) => {
      const transaction = db.transaction([STORE_QUESTIONS], 'readonly');
      const store = transaction.objectStore(STORE_QUESTIONS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });

    const images: ImageRecord[] = await new Promise((resolve) => {
        const transaction = db.transaction([STORE_IMAGES], 'readonly');
        const store = transaction.objectStore(STORE_IMAGES);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
    });

    if (questions.length === 0 && images.length === 0) return 0;

    const BATCH_SIZE = 400; 
    let syncedCount = 0;
    
    // --- SYNC QUESTIONS ---
    if (questions.length > 0) {
        for (let i = 0; i < questions.length; i += BATCH_SIZE) {
            const batch = writeBatch(this.firestore);
            const chunk = questions.slice(i, i + BATCH_SIZE);
            
            chunk.forEach(q => {
                const docRef = doc(this.firestore!, 'questions', q.id);
                const safeData = JSON.parse(JSON.stringify(q));
                batch.set(docRef, safeData, { merge: true });
            });

            await batch.commit();
            syncedCount += chunk.length;
        }
    }

    // --- SYNC IMAGES ---
    if (images.length > 0) {
        for (let i = 0; i < images.length; i += BATCH_SIZE) {
            const batch = writeBatch(this.firestore);
            const chunk = images.slice(i, i + BATCH_SIZE);
            
            // Use for...of loop to allow await for compression
            for (const img of chunk) {
                if (img.base64 === 'BLOCKED') continue; 
                
                let finalBase64 = img.base64;
                
                // Always try to optimize/compress to save bandwidth and storage.
                // This is especially important for syncing old images that might be raw PNGs.
                try {
                    finalBase64 = await compressBase64(finalBase64);
                } catch (err) {
                    console.warn("Compression failed during sync, trying original", err);
                }
                
                // Double check size after potential compression
                if (finalBase64.length > 1040000) {
                    console.error(`Image too big to sync (${finalBase64.length} bytes): ${img.prompt}`);
                    continue; 
                }

                const safeId = encodeURIComponent(img.prompt);
                const docRef = doc(this.firestore!, 'images', safeId);
                
                batch.set(docRef, {
                    prompt: img.prompt,
                    base64: finalBase64,
                    timestamp: img.timestamp
                }, { merge: true });
            }

            await batch.commit();
        }
    }

    return syncedCount;
  }

  async syncCloudToLocal(): Promise<number> {
    if (!this.firestore) throw new Error("Molnet ej konfigurerat (Firebase)");

    // NOTE: We only sync QUESTIONS downwards. 
    // Syncing 3000 images downwards would crash the browser storage/memory.
    // Images are treated as "Cloud Archive".

    const querySnapshot = await getDocs(collection(this.firestore, 'questions'));
    
    if (querySnapshot.empty) return 0;

    const db = await this.open();
    const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
    const store = transaction.objectStore(STORE_QUESTIONS);

    let count = 0;
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      store.put(data);
      count++;
    });
    
    return count;
  }

  // --- CLEANUP DUPLICATES ---

  // Helper to perform deduplication logic on a list of questions
  // Returns IDs to delete
  private identifyDuplicates(questions: any[]): string[] {
     const uniqueQuestions: any[] = [];
     const duplicateIds: string[] = [];
     
     // Sort so we keep oldest or newest? Let's keep newest (usually better formatted)
     // Actually, standard is usually keep oldest to preserve IDs, but here ID doesn't matter much.
     // Let's iterate.
     
     for (const q of questions) {
         const text = (q.text || "").trim().toUpperCase();
         if (text.length < 5) continue; // Skip broken/empty

         const qNums = extractNumbersFingerprint(text);
         
         let isDuplicate = false;
         
         // Check against accepted unique questions
         for (const unique of uniqueQuestions) {
             // 1. Subject Mismatch -> Not duplicate
             if (unique.subject && q.subject && unique.subject !== q.subject) continue;
             
             // 2. NUMBER GUARD: If numbers exist and are different -> Not duplicate
             // Example: "1+1" vs "2+2". Both have high similarity in text "VAD BLIR X PLUS Y", but numbers differ.
             const uNums = extractNumbersFingerprint((unique.text || ""));
             if (qNums !== uNums) {
                 continue; // Different numbers = Different question. Safe to keep.
             }
             
             // 3. Fuzzy Text Match
             // If numbers are same (or empty), check text similarity.
             const similarity = getSimilarity(text, (unique.text || "").toUpperCase());
             
             // Threshold: 85% similar triggers deletion of the new one
             if (similarity > 0.85) {
                 isDuplicate = true;
                 break;
             }
         }

         if (isDuplicate) {
             duplicateIds.push(q.id);
         } else {
             uniqueQuestions.push(q);
         }
     }
     
     return duplicateIds;
  }

  /**
   * Scans Firebase Cloud DB for smart duplicates (Fuzzy match + Number guard)
   */
  async cleanupDuplicatesCloud(): Promise<number> {
    if (!this.firestore) throw new Error("Molnet ej konfigurerat (Firebase)");

    const querySnapshot = await getDocs(collection(this.firestore, 'questions'));
    if (querySnapshot.empty) return 0;
    
    const questions: any[] = [];
    querySnapshot.forEach(doc => questions.push({ ...doc.data(), id: doc.id }));

    const duplicateIds = this.identifyDuplicates(questions);

    if (duplicateIds.length === 0) return 0;

    // Delete Duplicates in Batches
    const BATCH_SIZE = 400;
    let deletedCount = 0;

    for (let i = 0; i < duplicateIds.length; i += BATCH_SIZE) {
        const batch = writeBatch(this.firestore);
        const chunk = duplicateIds.slice(i, i + BATCH_SIZE);
        
        chunk.forEach(id => {
            batch.delete(doc(this.firestore!, 'questions', id));
        });

        await batch.commit();
        deletedCount += chunk.length;
    }

    return deletedCount;
  }

  /**
   * Scans Local IndexedDB for smart duplicates
   */
  async cleanupDuplicatesLocal(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
       const transaction = db.transaction([STORE_QUESTIONS], 'readwrite');
       const store = transaction.objectStore(STORE_QUESTIONS);
       const req = store.getAll();

       req.onsuccess = () => {
           const questions = req.result as Question[];
           const duplicateIds = this.identifyDuplicates(questions);

           if (duplicateIds.length > 0) {
               let processed = 0;
               duplicateIds.forEach(id => {
                   store.delete(id);
                   processed++;
               });
               resolve(processed);
           } else {
               resolve(0);
           }
       };
       
       req.onerror = () => reject("Failed to scan local DB");
    });
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
