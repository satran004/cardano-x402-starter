import React from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import { App } from './App';
import './style.css';
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
