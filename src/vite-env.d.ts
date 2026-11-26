/// <reference types="vite/client" />

/** The opening splash in index.html; App.tsx calls done() once the first real screen can draw. */
interface Window { cyraSplash?: { done(): void } }
