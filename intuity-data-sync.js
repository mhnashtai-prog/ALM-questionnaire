/**
 * INTUITY Universal Data Synchronization Layer
 * 
 * This ensures ALL data flows correctly between:
 * - Teacher creating questions
 * - Students viewing and answering questions
 * - Teacher viewing analytics and responses
 * 
 * CRITICAL: Every page must include this file and use these functions
 */

// Supabase Configuration (copy this to each page)
const INTUITY_CONFIG = {
  SUPABASE_URL: 'https://hpdebohqsvjlxeapzkrr.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZGVib2hxc3ZqbHhlYXB6a3JyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc4NzkxMTEsImV4cCI6MjA3MzQ1NTExMX0.mnOtWgJaxNDcroSYJSiPxqov47KY3KXOeeltSUL3adw'
};

// Universal Storage Keys - EVERYONE uses these
const STORAGE = {
  // Primary keys (always write here)
  QUESTIONS: 'intuity_questions',
  RESPONSES: 'intuity_responses',
  CURRENT_QUESTION: 'intuity_current_question',
  PUBLISHED_QUESTION: 'intuity_published_question',
  
  // Legacy keys (also write here for backward compatibility)
  LEGACY_QUESTIONS: ['alm_questions', 'current_question', 'question_history'],
  LEGACY_RESPONSES: ['alm_student_responses', 'student_responses']
};

class INTUITYDataSync {
  constructor() {
    this.supabase = null;
    this.isOnline = navigator.onLine;
    this.isConnected = false;
    
    this.initSupabase();
    this.setupOfflineHandling();
  }

  initSupabase() {
    try {
      if (window.supabase) {
        this.supabase = window.supabase.createClient(
          INTUITY_CONFIG.SUPABASE_URL,
          INTUITY_CONFIG.SUPABASE_ANON_KEY
        );
        this.testConnection();
        console.log('✅ INTUITY DataSync: Supabase initialized');
      } else {
        console.warn('⚠️ INTUITY DataSync: Supabase not available, using localStorage only');
      }
    } catch (error) {
      console.error('❌ INTUITY DataSync: Supabase init error:', error);
    }
  }

  async testConnection() {
    if (!this.supabase) return;
    
    try {
      const { data, error } = await this.supabase.from('questions').select('count').limit(1);
      if (!error) {
        this.isConnected = true;
        console.log('✅ INTUITY DataSync: Connected to Supabase');
      }
    } catch (error) {
      console.warn('⚠️ INTUITY DataSync: Supabase connection failed, using localStorage');
      this.isConnected = false;
    }
  }

  setupOfflineHandling() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 INTUITY DataSync: Back online');
      this.syncOfflineData();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('📱 INTUITY DataSync: Offline mode');
    });
  }

  // ============================================
  // TEACHER: PUBLISH QUESTION
  // ============================================
  async publishQuestion(questionData) {
    console.log('📝 INTUITY DataSync: Publishing question...', questionData);

    const question = {
      id: questionData.id || `q_${Date.now()}`,
      text: questionData.text || questionData.question_text,
      question_text: questionData.text || questionData.question_text,
      created_at: questionData.created_at || new Date().toISOString(),
      published_at: new Date().toISOString(),
      is_published: true,
      created_by: questionData.created_by || 'teacher',
      source: 'teacher',
      ...questionData
    };

    // STEP 1: Write to PRIMARY localStorage
    localStorage.setItem(STORAGE.CURRENT_QUESTION, JSON.stringify(question));
    localStorage.setItem(STORAGE.PUBLISHED_QUESTION, JSON.stringify(question));
    
    // STEP 2: Write to LEGACY localStorage (for backward compatibility)
    STORAGE.LEGACY_QUESTIONS.forEach(key => {
      try {
        localStorage.setItem(key, JSON.stringify(question));
      } catch (e) {
        console.warn(`Could not write to ${key}:`, e);
      }
    });

    // STEP 3: Add to questions array
    const allQuestions = this.getAllQuestions();
    const existingIndex = allQuestions.findIndex(q => q.id === question.id);
    if (existingIndex >= 0) {
      allQuestions[existingIndex] = question;
    } else {
      allQuestions.push(question);
    }
    localStorage.setItem(STORAGE.QUESTIONS, JSON.stringify(allQuestions));

    // STEP 4: Try to sync to Supabase
    if (this.isOnline && this.isConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('questions')
          .upsert([{
            id: question.id,
            text: question.text,
            created_at: question.created_at,
            published_at: question.published_at,
            is_published: true,
            created_by: question.created_by,
            metadata: {
              source: 'teacher',
              original_data: questionData
            }
          }])
          .select();

        if (!error && data) {
          console.log('✅ INTUITY DataSync: Question synced to Supabase', data[0]);
          return { success: true, question: data[0], synced: true };
        } else {
          console.warn('⚠️ INTUITY DataSync: Supabase sync failed, using localStorage', error);
        }
      } catch (error) {
        console.warn('⚠️ INTUITY DataSync: Supabase error, using localStorage', error);
      }
    }

    console.log('✅ INTUITY DataSync: Question published to localStorage');
    return { success: true, question, synced: false };
  }

  // ============================================
  // STUDENT: GET CURRENT QUESTION
  // ============================================
  async getCurrentQuestion() {
    console.log('🔍 INTUITY DataSync: Getting current question...');

    // STEP 1: Try Supabase first (if online)
    if (this.isOnline && this.isConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('questions')
          .select('*')
          .eq('is_published', true)
          .order('published_at', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0) {
          const question = data[0];
          // Cache it locally
          localStorage.setItem(STORAGE.CURRENT_QUESTION, JSON.stringify(question));
          console.log('✅ INTUITY DataSync: Got question from Supabase', question);
          return question;
        }
      } catch (error) {
        console.warn('⚠️ INTUITY DataSync: Supabase fetch failed, trying localStorage');
      }
    }

    // STEP 2: Try PRIMARY localStorage
    const stored = localStorage.getItem(STORAGE.CURRENT_QUESTION);
    if (stored && stored !== 'null') {
      try {
        const question = JSON.parse(stored);
        if (question && (question.text || question.question_text)) {
          console.log('✅ INTUITY DataSync: Got question from primary localStorage');
          return question;
        }
      } catch (e) {
        console.warn('Error parsing primary question:', e);
      }
    }

    // STEP 3: Try PUBLISHED localStorage
    const published = localStorage.getItem(STORAGE.PUBLISHED_QUESTION);
    if (published && published !== 'null') {
      try {
        const question = JSON.parse(published);
        if (question && (question.text || question.question_text)) {
          console.log('✅ INTUITY DataSync: Got question from published localStorage');
          return question;
        }
      } catch (e) {
        console.warn('Error parsing published question:', e);
      }
    }

    // STEP 4: Try LEGACY localStorage
    for (const key of STORAGE.LEGACY_QUESTIONS) {
      const legacy = localStorage.getItem(key);
      if (legacy && legacy !== 'null' && legacy !== '[]') {
        try {
          const parsed = JSON.parse(legacy);
          const question = Array.isArray(parsed) ? parsed[0] : parsed;
          if (question && (question.text || question.question_text)) {
            console.log(`✅ INTUITY DataSync: Got question from legacy key: ${key}`);
            return question;
          }
        } catch (e) {
          // Continue to next key
        }
      }
    }

    console.log('❌ INTUITY DataSync: No question found');
    return null;
  }

  // ============================================
  // STUDENT: SUBMIT RESPONSE
  // ============================================
  async submitResponse(responseData) {
    console.log('💾 INTUITY DataSync: Submitting response...', responseData);

    const response = {
      id: responseData.id || `r_${Date.now()}`,
      question_id: responseData.questionId || responseData.question_id,
      student_name: responseData.studentName || responseData.student_name,
      answer: responseData.answer,
      word_count: responseData.wordCount || responseData.word_count || 0,
      quality: responseData.quality,
      score: responseData.score,
      submitted_at: new Date().toISOString(),
      timestamp: responseData.timestamp || new Date().toLocaleString(),
      source: 'web',
      photo_url: responseData.photo_url || null,
      metadata: {
        questionText: responseData.questionText || responseData.question_text,
        original_data: responseData
      },
      ...responseData
    };

    // STEP 1: Write to PRIMARY localStorage
    const allResponses = this.getAllResponses();
    allResponses.push(response);
    localStorage.setItem(STORAGE.RESPONSES, JSON.stringify(allResponses));

    // STEP 2: Write to LEGACY localStorage
    STORAGE.LEGACY_RESPONSES.forEach(key => {
      try {
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        existing.push(response);
        localStorage.setItem(key, JSON.stringify(existing));
      } catch (e) {
        console.warn(`Could not write to ${key}:`, e);
      }
    });

    // STEP 3: Try to sync to Supabase
    if (this.isOnline && this.isConnected && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('student_responses')
          .insert([{
            question_id: response.question_id,
            student_name: response.student_name,
            answer: response.answer,
            word_count: response.word_count,
            quality: response.quality,
            score: response.score,
            source: 'web',
            metadata: response.metadata
          }])
          .select();

        if (!error && data) {
          console.log('✅ INTUITY DataSync: Response synced to Supabase', data[0]);
          return { success: true, response: data[0], synced: true };
        }
      } catch (error) {
        console.warn('⚠️ INTUITY DataSync: Supabase sync failed, saved locally', error);
      }
    }

    console.log('✅ INTUITY DataSync: Response saved to localStorage');
    return { success: true, response, synced: false };
  }

  // ============================================
  // TEACHER: GET ALL QUESTIONS
  // ============================================
  getAllQuestions() {
    const questions = new Map();

    // Get from primary storage
    try {
      const primary = JSON.parse(localStorage.getItem(STORAGE.QUESTIONS) || '[]');
      primary.forEach(q => {
        if (q && (q.text || q.question_text)) {
          questions.set(q.id, q);
        }
      });
    } catch (e) {
      console.warn('Error loading primary questions:', e);
    }

    // Get from legacy storage
    STORAGE.LEGACY_QUESTIONS.forEach(key => {
      try {
        const stored = localStorage.getItem(key);
        if (stored && stored !== 'null' && stored !== '[]') {
          const parsed = JSON.parse(stored);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          items.forEach(q => {
            if (q && (q.text || q.question_text) && !questions.has(q.id)) {
              questions.set(q.id, q);
            }
          });
        }
      } catch (e) {
        // Continue
      }
    });

    return Array.from(questions.values());
  }

  // ============================================
  // TEACHER: GET ALL RESPONSES
  // ============================================
  getAllResponses() {
    const responses = [];
    const seen = new Set();

    // Get from primary storage
    try {
      const primary = JSON.parse(localStorage.getItem(STORAGE.RESPONSES) || '[]');
      primary.forEach(r => {
        if (r && r.answer) {
          const key = `${r.student_name}-${r.answer.substring(0,50)}-${r.submitted_at}`;
          if (!seen.has(key)) {
            responses.push(r);
            seen.add(key);
          }
        }
      });
    } catch (e) {
      console.warn('Error loading primary responses:', e);
    }

    // Get from legacy storage
    STORAGE.LEGACY_RESPONSES.forEach(key => {
      try {
        const stored = localStorage.getItem(key);
        if (stored && stored !== '[]') {
          const parsed = JSON.parse(stored);
          parsed.forEach(r => {
            if (r && r.answer) {
              const responseKey = `${r.student_name || r.studentName}-${r.answer.substring(0,50)}-${r.submitted_at || r.submittedAt}`;
              if (!seen.has(responseKey)) {
                responses.push(r);
                seen.add(responseKey);
              }
            }
          });
        }
      } catch (e) {
        // Continue
      }
    });

    return responses;
  }

  // ============================================
  // UTILITY: Sync offline data when back online
  // ============================================
  async syncOfflineData() {
    if (!this.isOnline || !this.isConnected || !this.supabase) return;

    console.log('🔄 INTUITY DataSync: Syncing offline data...');

    // Sync responses
    const responses = this.getAllResponses();
    for (const response of responses) {
      if (!response.synced) {
        try {
          await this.submitResponse(response);
        } catch (error) {
          console.warn('Failed to sync response:', error);
        }
      }
    }

    console.log('✅ INTUITY DataSync: Sync complete');
  }
}

// Create global instance
window.intuitySync = new INTUITYDataSync();

console.log('🚀 INTUITY DataSync Layer Loaded');
