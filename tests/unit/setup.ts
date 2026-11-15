import { beforeEach, afterEach, vi } from 'vitest';
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unmocked network request forbidden')}))});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
