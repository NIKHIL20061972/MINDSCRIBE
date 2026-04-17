import { useState, useCallback } from 'react';
import { 
  FileText, 
  Upload, 
  MessageCircle, 
  BookOpen, 
  HelpCircle,
  Send,
  Loader2,
  CheckCircle,
  Sparkles,
  Copy,
  Check,
  X,
  Trophy,
  RotateCcw,
  Play,
  Lightbulb,
  Brain,
  Flame
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Types
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation?: string;
}

interface UserAnswer {
  questionId: string;
  selectedAnswer: string | null;
  isCorrect: boolean;
}

// Gemini API Configuration - API Key integrated directly
const GEMINI_API_KEY = "AQ.Ab8RN6IhGfxlvRBIMD1iinKs4y5wBDMgxR1v8e4YQTmpq7umYg";

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
];

// Gemini API call with model fallback
const callGemini = async (prompt: string, retryIndex = 0): Promise<string> => {
  const model = GEMINI_MODELS[retryIndex] || GEMINI_MODELS[GEMINI_MODELS.length - 1];
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          }
        }),
      }
    );

    const data = await response.json();
    
    if (data.error) {
      const errorMsg = data.error.message || 'API Error';
      if (errorMsg.includes('not found') && retryIndex < GEMINI_MODELS.length - 1) {
        console.log(`Model ${model} not found, trying ${GEMINI_MODELS[retryIndex + 1]}...`);
        return callGemini(prompt, retryIndex + 1);
      }
      throw new Error(errorMsg);
    }
    
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
  } catch (error) {
    if (retryIndex < GEMINI_MODELS.length - 1) {
      console.log(`Retrying with ${GEMINI_MODELS[retryIndex + 1]}...`);
      return callGemini(prompt, retryIndex + 1);
    }
    console.error('Gemini API Error:', error);
    throw error;
  }
};

// PDF Text Extraction
const extractTextFromPDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n\n';
  }
  
  return fullText.trim();
};

// Parse Quiz from AI response
const parseQuiz = (quizText: string): QuizQuestion[] => {
  const questions: QuizQuestion[] = [];
  const lines = quizText.split('\n');
  
  let currentQuestion: Partial<QuizQuestion> & { id: string } = { 
    id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` 
  };
  let currentDifficulty: 'easy' | 'medium' | 'hard' = 'easy';
  let inQuestion = false;
  let questionCount = 0;
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Detect difficulty sections
    if (lowerLine.includes('## easy') || (lowerLine.includes('easy') && lowerLine.includes('question'))) {
      currentDifficulty = 'easy';
      continue;
    }
    if (lowerLine.includes('## medium') || (lowerLine.includes('medium') && lowerLine.includes('question'))) {
      currentDifficulty = 'medium';
      continue;
    }
    if (lowerLine.includes('## hard') || (lowerLine.includes('hard') && lowerLine.includes('question'))) {
      currentDifficulty = 'hard';
      continue;
    }
    
    // Match question
    const questionMatch = line.match(/^\d+[\.\\)]\s*(.+)/i);
    if (questionMatch) {
      // Save previous question if complete
      if (currentQuestion.question && currentQuestion.options?.length === 4 && currentQuestion.correctAnswer) {
        questions.push({
          id: currentQuestion.id,
          question: currentQuestion.question,
          options: currentQuestion.options,
          correctAnswer: currentQuestion.correctAnswer,
          difficulty: currentDifficulty,
          explanation: currentQuestion.explanation
        });
        questionCount++;
      }
      // Start new question
      currentQuestion = {
        id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        question: questionMatch[1].trim(),
        options: [],
        difficulty: currentDifficulty
      };
      inQuestion = true;
      continue;
    }
    
    // Match options
    const optionMatch = line.match(/^[a-d][\.\)]\s*(.+)/i);
    if (optionMatch && inQuestion) {
      currentQuestion.options = currentQuestion.options || [];
      currentQuestion.options.push(optionMatch[1].trim());
      continue;
    }
    
    // Match answer
    const answerMatch = line.match(/(?:answer|correct)[:\s]+([a-d])/i);
    if (answerMatch && inQuestion) {
      currentQuestion.correctAnswer = answerMatch[1].toUpperCase();
    }
    
    // Match explanation
    const explanationMatch = line.match(/(?:explanation|why)[:\s]+(.+)/i);
    if (explanationMatch && inQuestion) {
      currentQuestion.explanation = explanationMatch[1].trim();
    }
  }
  
  // Don't forget the last question
  if (currentQuestion.question && currentQuestion.options?.length === 4 && currentQuestion.correctAnswer) {
    questions.push({
      id: currentQuestion.id,
      question: currentQuestion.question,
      options: currentQuestion.options,
      correctAnswer: currentQuestion.correctAnswer,
      difficulty: currentDifficulty,
      explanation: currentQuestion.explanation
    });
  }
  
  return questions;
};

// Difficulty Badge Component
const DifficultyBadge = ({ difficulty }: { difficulty: 'easy' | 'medium' | 'hard' }) => {
  const config = {
    easy: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', icon: Lightbulb },
    medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: Brain },
    hard: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', icon: Flame }
  };
  
  const { bg, text, border, icon: Icon } = config[difficulty];
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${bg} ${text} border ${border} capitalize`}>
      <Icon className="w-3 h-3" />
      {difficulty}
    </span>
  );
};

function App() {
  // State
  const [documentText, setDocumentText] = useState<string>('');
  const [documentName, setDocumentName] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'summary' | 'quiz' | 'qa'>('summary');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  
  // Quiz state
  const [quizMode, setQuizMode] = useState<'browse' | 'practice' | 'results'>('browse');
  const [quizFilter, setQuizFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Map<string, UserAnswer>>(new Map());
  const [showResults, setShowResults] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  // Copy to clipboard
  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  // Handle file upload
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.name.endsWith('.pdf')) {
      setError('Please upload a valid PDF file');
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Extracting text from PDF...');
    setError('');

    try {
      const text = await extractTextFromPDF(file);
      if (!text || text.length < 50) {
        throw new Error('Could not extract meaningful text from this PDF');
      }
      
      setDocumentText(text);
      setDocumentName(file.name);
      setSummary('');
      setQuiz([]);
      setMessages([]);
      setActiveTab('summary');
      setQuizMode('browse');
      setUserAnswers(new Map());
      setShowResults(false);
      
      // Auto-generate summary
      setLoadingMessage('Generating summary...');
      const summaryPrompt = `Please provide a comprehensive summary of the following document. Structure your response with:

## Overview
A brief 2-3 sentence overview of what the document is about.

## Key Points
- List the main key points as bullet points

## Important Details
Any specific details, numbers, dates, or facts worth noting

## Conclusion
A brief concluding thought about the document

Document content:
${text.substring(0, 30000)}`;

      const summaryResult = await callGemini(summaryPrompt);
      setSummary(summaryResult);

      // Generate quiz
      setLoadingMessage('Generating quiz questions...');
      const quizPrompt = `Create a quiz based on the following document. Generate exactly 15 questions (5 easy, 5 medium, 5 hard) in this EXACT format:

## EASY QUESTIONS

1. [Question text here?]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
Answer: [A/B/C/D]
Explanation: [Brief explanation of why this is correct]

2. [Next question...]

## MEDIUM QUESTIONS

6. [Question text here?]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
Answer: [A/B/C/D]
Explanation: [Brief explanation]

## HARD QUESTIONS

11. [Question text here?]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
Answer: [A/B/C/D]
Explanation: [Brief explanation]

IMPORTANT: Make sure questions are directly derived from the document content. Easy questions should test basic recall, medium should test understanding, and hard should test analysis or synthesis.

Document content:
${text.substring(0, 25000)}`;

      const quizResult = await callGemini(quizPrompt);
      const parsedQuiz = parseQuiz(quizResult);
      setQuiz(parsedQuiz);

    } catch (err: any) {
      setError(err.message || 'Error processing PDF');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, []);

  // Ask question
  const askQuestion = async () => {
    if (!currentQuestion.trim() || !documentText) return;

    const userMessage: Message = { role: 'user', content: currentQuestion };
    setMessages(prev => [...prev, userMessage]);
    setCurrentQuestion('');
    setIsLoading(true);
    setLoadingMessage('Thinking...');

    try {
      const prompt = `You are a helpful assistant. Answer the question based ONLY on the document content provided below. If the answer is not in the document, say so.

Document content:
${documentText.substring(0, 25000)}

Question: ${currentQuestion}

Provide a clear and accurate answer based only on the document:`;

      const answer = await callGemini(prompt);
      const assistantMessage: Message = { role: 'assistant', content: answer };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      setError(err.message || 'Error getting answer');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Quiz functions
  const startPractice = (difficulty?: 'easy' | 'medium' | 'hard') => {
    const filteredQuestions = difficulty 
      ? quiz.filter(q => q.difficulty === difficulty)
      : quiz;
    
    if (filteredQuestions.length === 0) return;
    
    setQuiz(difficulty ? filteredQuestions : quiz);
    setQuizMode('practice');
    setCurrentQuestionIndex(0);
    setUserAnswers(new Map());
    setShowResults(false);
    setSelectedAnswer(null);
  };

  const handleAnswerSelect = (answer: string) => {
    if (showResults) return;
    setSelectedAnswer(answer);
  };

  const submitAnswer = () => {
    if (!selectedAnswer) return;
    
    const currentQ = quiz[currentQuestionIndex];
    const isCorrect = selectedAnswer === currentQ.correctAnswer;
    
    setUserAnswers(prev => new Map(prev).set(currentQ.id, {
      questionId: currentQ.id,
      selectedAnswer,
      isCorrect
    }));
    
    setShowResults(true);
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quiz.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setShowResults(false);
    } else {
      setQuizMode('results');
    }
  };

  const resetQuiz = () => {
    setQuizMode('browse');
    setCurrentQuestionIndex(0);
    setUserAnswers(new Map());
    setShowResults(false);
    setSelectedAnswer(null);
  };

  // Calculate score
  const getScore = () => {
    let correct = 0;
    userAnswers.forEach(answer => {
      if (answer.isCorrect) correct++;
    });
    return { correct, total: quiz.length, percentage: Math.round((correct / quiz.length) * 100) };
  };

  // Filtered quiz for browse mode
  const filteredQuiz = quizFilter === 'all' 
    ? quiz 
    : quiz.filter(q => q.difficulty === quizFilter);

  // Get difficulty stats
  const getDifficultyStats = () => {
    const stats = { easy: 0, medium: 0, hard: 0 };
    quiz.forEach(q => stats[q.difficulty]++);
    return stats;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">MindScribe</h1>
              <p className="text-xs text-slate-400">AI-Powered Document Analysis</p>
            </div>
          </div>
          {documentName && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
              <FileText className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-slate-300 max-w-[200px] truncate">{documentName}</span>
              <CheckCircle className="w-4 h-4 text-green-400" />
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Upload Section */}
        {!documentText && (
          <div className="mb-8">
            <div className="relative border-2 border-dashed border-slate-600 rounded-2xl p-12 text-center hover:border-blue-500 transition-colors group bg-slate-800/30">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center group-hover:from-blue-500/30 group-hover:to-purple-500/30 transition-colors">
                  <Upload className="w-8 h-8 text-blue-400" />
                </div>
                <div>
                  <p className="text-lg font-medium text-white mb-1">Upload your PDF document</p>
                  <p className="text-sm text-slate-400">Drag and drop or click to browse</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
            {error}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-2xl p-8 flex flex-col items-center gap-4 border border-slate-700">
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              <p className="text-white font-medium">{loadingMessage}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        {documentText && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-4 sticky top-24">
                <h3 className="text-sm font-medium text-slate-400 mb-3">Actions</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      activeTab === 'summary'
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : 'text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    <BookOpen className="w-5 h-5" />
                    <span className="font-medium">Summary</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('quiz')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      activeTab === 'quiz'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    <HelpCircle className="w-5 h-5" />
                    <span className="font-medium">Quiz</span>
                    {quiz.length > 0 && (
                      <span className="ml-auto bg-purple-500/30 text-purple-300 text-xs px-2 py-0.5 rounded-full">
                        {quiz.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('qa')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                      activeTab === 'qa'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span className="font-medium">Q&A</span>
                  </button>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-700">
                  <button
                    onClick={() => {
                      setDocumentText('');
                      setDocumentName('');
                      setSummary('');
                      setQuiz([]);
                      setMessages([]);
                      setQuizMode('browse');
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-xl transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload New PDF</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Main Panel */}
            <div className="lg:col-span-3">
              {/* Summary Tab */}
              {activeTab === 'summary' && summary && (
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <h2 className="text-xl font-semibold text-white">Document Summary</h2>
                    </div>
                    <button
                      onClick={() => copyToClipboard(summary, 'summary')}
                      className="flex items-center gap-2 px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
                    >
                      {copied === 'summary' ? (
                        <>
                          <Check className="w-4 h-4 text-green-400" />
                          <span className="text-green-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="prose prose-invert prose-blue max-w-none">
                    <div className="text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {summary.split('\n').map((line, i) => {
                        if (line.startsWith('## ')) {
                          return <h2 key={i} className="text-xl font-bold text-white mt-6 mb-3">{line.replace('## ', '')}</h2>;
                        }
                        if (line.startsWith('### ')) {
                          return <h3 key={i} className="text-lg font-semibold text-blue-400 mt-4 mb-2">{line.replace('### ', '')}</h3>;
                        }
                        if (line.startsWith('- ')) {
                          return <li key={i} className="text-slate-300 ml-4 my-1">{line.replace('- ', '')}</li>;
                        }
                        if (line.trim() === '') {
                          return <br key={i} />;
                        }
                        return <p key={i} className="my-2">{line}</p>;
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Quiz Tab */}
              {activeTab === 'quiz' && (
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                        <HelpCircle className="w-5 h-5 text-white" />
                      </div>
                      <h2 className="text-xl font-semibold text-white">Quiz Questions</h2>
                    </div>
                    {quiz.length > 0 && quizMode === 'browse' && (
                      <button
                        onClick={() => startPractice()}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
                      >
                        <Play className="w-4 h-4" />
                        Start Practice
                      </button>
                    )}
                  </div>

                  {/* Browse Mode */}
                  {quizMode === 'browse' && (
                    <>
                      {/* Difficulty Stats */}
                      {quiz.length > 0 && (
                        <div className="grid grid-cols-3 gap-4 mb-6">
                          <button
                            onClick={() => startPractice('easy')}
                            className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 hover:bg-green-500/20 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Lightbulb className="w-5 h-5 text-green-400" />
                              <span className="text-green-400 font-semibold">Easy</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{getDifficultyStats().easy}</p>
                            <p className="text-xs text-slate-400">questions</p>
                          </button>
                          <button
                            onClick={() => startPractice('medium')}
                            className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 hover:bg-yellow-500/20 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Brain className="w-5 h-5 text-yellow-400" />
                              <span className="text-yellow-400 font-semibold">Medium</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{getDifficultyStats().medium}</p>
                            <p className="text-xs text-slate-400">questions</p>
                          </button>
                          <button
                            onClick={() => startPractice('hard')}
                            className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 hover:bg-red-500/20 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Flame className="w-5 h-5 text-red-400" />
                              <span className="text-red-400 font-semibold">Hard</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{getDifficultyStats().hard}</p>
                            <p className="text-xs text-slate-400">questions</p>
                          </button>
                        </div>
                      )}

                      {/* Quiz Filter */}
                      <div className="flex gap-2 mb-6">
                        {['all', 'easy', 'medium', 'hard'].map((filter) => (
                          <button
                            key={filter}
                            onClick={() => setQuizFilter(filter as any)}
                            className={`px-4 py-2 rounded-lg font-medium capitalize transition-all ${
                              quizFilter === filter
                                ? filter === 'easy' ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : filter === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                : filter === 'hard' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                : 'text-slate-400 hover:bg-slate-700/50'
                            }`}
                          >
                            {filter}
                          </button>
                        ))}
                      </div>

                      {/* Questions List */}
                      {filteredQuiz.length > 0 ? (
                        <div className="space-y-3">
                          {filteredQuiz.map((q, index) => (
                            <div
                              key={q.id}
                              className="bg-slate-700/30 rounded-xl border border-slate-600 overflow-hidden"
                            >
                              <div className="p-4">
                                <div className="flex items-start gap-3 mb-3">
                                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                                    q.difficulty === 'easy' ? 'bg-green-500/20 text-green-400' :
                                    q.difficulty === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-red-500/20 text-red-400'
                                  }`}>
                                    {index + 1}
                                  </span>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <DifficultyBadge difficulty={q.difficulty} />
                                    </div>
                                    <p className="text-white font-medium">{q.question}</p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 ml-11">
                                  {q.options.map((option, optIndex) => (
                                    <div
                                      key={optIndex}
                                      className={`p-3 rounded-lg ${
                                        String.fromCharCode(65 + optIndex) === q.correctAnswer
                                          ? 'bg-green-500/20 border border-green-500/30 text-green-300'
                                          : 'bg-slate-600/50 text-slate-300'
                                      }`}
                                    >
                                      <span className="font-medium mr-2">{String.fromCharCode(65 + optIndex)}.</span>
                                      {option}
                                      {String.fromCharCode(65 + optIndex) === q.correctAnswer && (
                                        <CheckCircle className="inline-block w-4 h-4 ml-2 text-green-400" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-slate-400">
                          <HelpCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                          <p>No quiz questions generated yet</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Practice Mode */}
                  {quizMode === 'practice' && quiz.length > 0 && (
                    <div className="space-y-6">
                      {/* Progress Bar */}
                      <div className="relative">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-slate-400">Question {currentQuestionIndex + 1} of {quiz.length}</span>
                          <DifficultyBadge difficulty={quiz[currentQuestionIndex].difficulty} />
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-600 transition-all duration-300"
                            style={{ width: `${((currentQuestionIndex + 1) / quiz.length) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Question */}
                      <div className="bg-slate-700/30 rounded-2xl p-6">
                        <h3 className="text-lg font-semibold text-white mb-6">
                          {quiz[currentQuestionIndex].question}
                        </h3>
                        
                        <div className="space-y-3">
                          {quiz[currentQuestionIndex].options.map((option, index) => {
                            const optionLetter = String.fromCharCode(65 + index);
                            const isSelected = selectedAnswer === optionLetter;
                            const isCorrect = quiz[currentQuestionIndex].correctAnswer === optionLetter;
                            
                            let optionClass = 'bg-slate-600/50 border-slate-500 hover:bg-slate-600 hover:border-slate-400';
                            
                            if (showResults) {
                              if (isCorrect) {
                                optionClass = 'bg-green-500/20 border-green-500 text-green-300';
                              } else if (isSelected && !isCorrect) {
                                optionClass = 'bg-red-500/20 border-red-500 text-red-300';
                              }
                            } else if (isSelected) {
                              optionClass = 'bg-purple-500/20 border-purple-500 text-white';
                            }
                            
                            return (
                              <button
                                key={index}
                                onClick={() => handleAnswerSelect(optionLetter)}
                                disabled={showResults}
                                className={`w-full p-4 rounded-xl border text-left transition-all ${optionClass}`}
                              >
                                <span className="font-medium mr-2">{optionLetter}.</span>
                                {option}
                                {showResults && isCorrect && (
                                  <CheckCircle className="inline-block w-5 h-5 ml-2 text-green-400" />
                                )}
                                {showResults && isSelected && !isCorrect && (
                                  <X className="inline-block w-5 h-5 ml-2 text-red-400" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Explanation */}
                        {showResults && quiz[currentQuestionIndex].explanation && (
                          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                            <p className="text-sm text-blue-300">
                              <strong>Explanation:</strong> {quiz[currentQuestionIndex].explanation}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex justify-between">
                        <button
                          onClick={resetQuiz}
                          className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-xl transition-all"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Exit Practice
                        </button>
                        
                        {!showResults ? (
                          <button
                            onClick={submitAnswer}
                            disabled={!selectedAnswer}
                            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Submit Answer
                          </button>
                        ) : (
                          <button
                            onClick={nextQuestion}
                            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
                          >
                            {currentQuestionIndex < quiz.length - 1 ? 'Next Question' : 'See Results'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Results Mode */}
                  {quizMode === 'results' && (
                    <div className="text-center py-8">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mx-auto mb-6">
                        <Trophy className="w-12 h-12 text-white" />
                      </div>
                      
                      <h3 className="text-2xl font-bold text-white mb-2">Quiz Complete!</h3>
                      <p className="text-slate-400 mb-6">Here's how you performed</p>
                      
                      <div className="flex items-center justify-center gap-8 mb-8">
                        <div className="text-center">
                          <p className="text-4xl font-bold text-white">{getScore().correct}</p>
                          <p className="text-sm text-slate-400">Correct</p>
                        </div>
                        <div className="w-px h-16 bg-slate-600" />
                        <div className="text-center">
                          <p className="text-4xl font-bold text-white">{getScore().total}</p>
                          <p className="text-sm text-slate-400">Total</p>
                        </div>
                        <div className="w-px h-16 bg-slate-600" />
                        <div className="text-center">
                          <p className="text-4xl font-bold text-white">{getScore().percentage}%</p>
                          <p className="text-sm text-slate-400">Score</p>
                        </div>
                      </div>

                      <div className="flex justify-center gap-4">
                        <button
                          onClick={resetQuiz}
                          className="flex items-center gap-2 px-6 py-3 bg-slate-700 text-white font-medium rounded-xl hover:bg-slate-600 transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Back to Quiz
                        </button>
                        <button
                          onClick={() => startPractice()}
                          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
                        >
                          <Play className="w-4 h-4" />
                          Try Again
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Q&A Tab */}
              {activeTab === 'qa' && (
                <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center">
                      <MessageCircle className="w-5 h-5 text-white" />
                    </div>
                    <h2 className="text-xl font-semibold text-white">Ask Questions</h2>
                  </div>

                  {/* Messages */}
                  <div className="space-y-4 mb-6 max-h-[400px] overflow-y-auto">
                    {messages.length === 0 ? (
                      <div className="text-center py-8 text-slate-400">
                        <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>Ask any question about your document</p>
                      </div>
                    ) : (
                      messages.map((msg, index) => (
                        <div
                          key={index}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] p-4 rounded-2xl ${
                              msg.role === 'user'
                                ? 'bg-blue-500 text-white'
                                : 'bg-slate-700 text-slate-200'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Input */}
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={currentQuestion}
                      onChange={(e) => setCurrentQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
                      placeholder="Type your question..."
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                      onClick={askQuestion}
                      disabled={!currentQuestion.trim()}
                      className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-medium rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
