import Groq from 'groq-sdk';
import { embed } from './embedding.service.js';
import { query } from './vector-store.service.js';
import { MemoryModel } from '../models/memory.model.js';
import logger from '../utils/logger.js';

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions based on the user's saved content. Use the provided context to answer accurately. If the context doesn't contain enough information to answer, say so politely. Always cite the source title when referencing information.`;

export interface Source {
  title: string;
  url: string;
  score: number;
}

export interface AskResult {
  answer: string;
  sources: Source[];
}

export async function ask(question: string, userId: string): Promise<AskResult> {
  const [questionVector] = await embed([question]);
  const matches = await query(userId, questionVector, 10);

  if (matches.length === 0) {
    return { answer: 'I could not find any relevant information in your saved content to answer this question.', sources: [] };
  }

  const contextChunks = matches.slice(0, 5);
  const context = contextChunks.map((m) => `[Source: ${m.memoryId}]\n${m.text}`).join('\n\n');

  const memoryIds = [...new Set(matches.map((m) => m.memoryId))];
  const memories = await MemoryModel.find({ _id: { $in: memoryIds } }, { title: 1, url: 1 }).lean();
  const memoryMap = new Map(memories.map((m) => [m._id.toString(), m]));

  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (!seen.has(match.memoryId)) {
      seen.add(match.memoryId);
      const memory = memoryMap.get(match.memoryId);
      if (memory) {
        sources.push({ title: memory.title, url: memory.url, score: match.score });
      }
    }
  }

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Context from saved content:\n\n${context}\n\nQuestion: ${question}` },
    ],
    temperature: 0.3,
  });

  const answer = completion.choices[0]?.message?.content || '';
  return { answer, sources };
}

export async function* askStream(question: string, userId: string): AsyncGenerator<string> {
  const [questionVector] = await embed([question]);
  const matches = await query(userId, questionVector, 10);

  let sources: Source[] = [];

  if (matches.length > 0) {
    const memoryIds = [...new Set(matches.map((m) => m.memoryId))];
    const memories = await MemoryModel.find({ _id: { $in: memoryIds } }, { title: 1, url: 1 }).lean();
    const memoryMap = new Map(memories.map((m) => [m._id.toString(), m]));

    const seen = new Set<string>();
    for (const match of matches) {
      if (!seen.has(match.memoryId)) {
        seen.add(match.memoryId);
        const memory = memoryMap.get(match.memoryId);
        if (memory) {
          sources.push({ title: memory.title, url: memory.url, score: match.score });
        }
      }
    }
  }

  if (matches.length === 0) {
    yield `data: ${JSON.stringify({ type: 'token', content: 'I could not find any relevant information in your saved content to answer this question.' })}\n\n`;
  } else {
    const contextChunks = matches.slice(0, 5);
    const context = contextChunks.map((m) => `[Source: ${m.memoryId}]\n${m.text}`).join('\n\n');

    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Context from saved content:\n\n${context}\n\nQuestion: ${question}` },
      ],
      temperature: 0.3,
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        yield `data: ${JSON.stringify({ type: 'token', content: token })}\n\n`;
      }
    }
  }

  yield `data: ${JSON.stringify({ type: 'sources', sources })}\n\n`;
  yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
}
